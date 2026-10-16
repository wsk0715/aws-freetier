import { createHmac } from 'node:crypto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../store')>()),
  putReceipt: vi.fn(),
  sendWorkMessage: vi.fn(),
}))

import * as store from '../store'

import { MAX_BODY_BYTES, handler } from './handler'

const PATH_SECRET = 'path-secret'
const SIGNING_SECRET = 'signing-secret'
const PATH = `/${PATH_SECRET}`
const BODY = '{"id":"evt_1","type":"order.created","data":{"total":10}}'
const NOW = Math.floor(Date.now() / 1000)

function sign(timestamp: number, body: string, secret = SIGNING_SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`
}

function request(overrides: Partial<Parameters<typeof handler>[0]> = {}) {
  return {
    rawPath: PATH,
    headers: {
      'content-type': 'application/json',
      'x-webhook-timestamp': String(NOW),
      'x-webhook-signature': sign(NOW, BODY),
    },
    body: BODY,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('RECEIVE_PATH', PATH_SECRET)
  vi.stubEnv('WEBHOOK_SIGNING_SECRET', SIGNING_SECRET)
  vi.stubEnv('INBOX_TABLE', 'test-table')
  vi.stubEnv('WORK_QUEUE_URL', 'https://example.invalid/queue')
  vi.stubEnv('RETENTION_DAYS', '30')
})

describe('수신 경로 보호', () => {
  it('비밀 경로가 아니면 저장하지 않고 404를 반환한다', async () => {
    const response = await handler(request({ rawPath: '/다른경로' }))
    expect(response.statusCode).toBe(404)
    expect(store.putReceipt).not.toHaveBeenCalled()
    expect(store.sendWorkMessage).not.toHaveBeenCalled()
  })

  it('경로가 없으면 404를 반환한다', async () => {
    expect((await handler(request({ rawPath: undefined }))).statusCode).toBe(404)
  })

  it('비밀값을 응답 본문에 넣지 않는다', async () => {
    const response = await handler(request({ rawPath: '/다른경로' }))
    expect(response.body).not.toContain(PATH_SECRET)
  })
})

describe('발신자 검증', () => {
  it('타임스탬프 헤더가 없으면 401을 반환한다', async () => {
    const response = await handler(
      request({ headers: { 'content-type': 'application/json', 'x-webhook-signature': sign(NOW, BODY) } }),
    )
    expect(response.statusCode).toBe(401)
    expect(store.putReceipt).not.toHaveBeenCalled()
  })

  it('서명 헤더가 없으면 401을 반환한다', async () => {
    const response = await handler(
      request({ headers: { 'content-type': 'application/json', 'x-webhook-timestamp': String(NOW) } }),
    )
    expect(response.statusCode).toBe(401)
  })

  it('서명이 틀리면 401을 반환한다', async () => {
    const response = await handler(
      request({ headers: { 'x-webhook-timestamp': String(NOW), 'x-webhook-signature': sign(NOW, '다른 본문') } }),
    )
    expect(response.statusCode).toBe(401)
    expect(store.sendWorkMessage).not.toHaveBeenCalled()
  })

  it('본문이 변조되면 401을 반환한다', async () => {
    const response = await handler(request({ body: `${BODY} ` }))
    expect(response.statusCode).toBe(401)
    expect(store.putReceipt).not.toHaveBeenCalled()
  })

  it('다른 비밀값으로 만든 서명은 401을 반환한다', async () => {
    const response = await handler(
      request({ headers: { 'x-webhook-timestamp': String(NOW), 'x-webhook-signature': sign(NOW, BODY, '다른 비밀값') } }),
    )
    expect(response.statusCode).toBe(401)
  })

  it('허용 오차를 넘긴 시각은 401을 반환한다', async () => {
    const stale = NOW - 3600
    const response = await handler(
      request({ headers: { 'x-webhook-timestamp': String(stale), 'x-webhook-signature': sign(stale, BODY) } }),
    )
    expect(response.statusCode).toBe(401)
    expect(store.putReceipt).not.toHaveBeenCalled()
  })
})

describe('본문 상한', () => {
  it('상한을 넘으면 저장 전에 413으로 거절한다', async () => {
    const large = 'a'.repeat(MAX_BODY_BYTES + 1)
    const response = await handler(
      request({ body: large, headers: { 'x-webhook-timestamp': String(NOW), 'x-webhook-signature': sign(NOW, large) } }),
    )
    expect(response.statusCode).toBe(413)
    expect(store.putReceipt).not.toHaveBeenCalled()
    expect(store.sendWorkMessage).not.toHaveBeenCalled()
  })

  it('상한을 문자 수가 아니라 바이트로 센다', async () => {
    const multibyte = '가'.repeat(Math.ceil(MAX_BODY_BYTES / 3))
    const response = await handler(
      request({
        body: multibyte,
        headers: { 'x-webhook-timestamp': String(NOW), 'x-webhook-signature': sign(NOW, multibyte) },
      }),
    )
    expect(response.statusCode).toBe(413)
  })
})

describe('정상 수신', () => {
  it('원문을 그대로 저장하고 작업 큐에 적재한 뒤 202를 반환한다', async () => {
    const response = await handler(request())

    expect(response.statusCode).toBe(202)
    expect(store.putReceipt).toHaveBeenCalledTimes(1)
    expect(store.putReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        inboxId: 'inbox',
        status: '수신됨',
        rawBody: BODY,
        headers: expect.objectContaining({ 'x-webhook-signature': expect.stringMatching(/^sha256=/) }),
        bodyBytes: Buffer.byteLength(BODY, 'utf8'),
        contentType: 'application/json',
      }),
    )
    expect(store.sendWorkMessage).toHaveBeenCalledTimes(1)
  })

  it('저장한 항목의 키를 그대로 작업 큐에 넘긴다', async () => {
    let storedKey: string | undefined
    vi.mocked(store.putReceipt).mockImplementation(async (item) => {
      storedKey = item.sortKey
    })

    await handler(request())

    expect(storedKey).toBeDefined()
    expect(store.sendWorkMessage).toHaveBeenCalledWith(storedKey)
  })

  it('JSON 스키마를 해석하지 않고 잘못된 JSON도 저장한다', async () => {
    const malformed = 'not json'
    const response = await handler(
      request({
        body: malformed,
        headers: { 'x-webhook-timestamp': String(NOW), 'x-webhook-signature': sign(NOW, malformed) },
      }),
    )
    expect(response.statusCode).toBe(202)
    expect(store.putReceipt).toHaveBeenCalledWith(expect.objectContaining({ rawBody: malformed }))
  })

  it('base64로 인코딩된 본문도 원문 기준으로 검증하고 저장한다', async () => {
    const response = await handler(
      request({ body: Buffer.from(BODY, 'utf8').toString('base64'), isBase64Encoded: true }),
    )
    expect(response.statusCode).toBe(202)
    expect(store.putReceipt).toHaveBeenCalledWith(expect.objectContaining({ rawBody: BODY }))
  })

  it('대문자 헤더 이름도 받아들인다', async () => {
    const response = await handler(
      request({ headers: { 'X-Webhook-Timestamp': String(NOW), 'X-Webhook-Signature': sign(NOW, BODY) } }),
    )
    expect(response.statusCode).toBe(202)
  })
})

describe('의존 실패', () => {
  it('저장에 실패하면 큐에 적재하지 않고 500을 반환한다', async () => {
    vi.mocked(store.putReceipt).mockRejectedValueOnce(new Error('저장 실패'))
    const response = await handler(request())
    expect(response.statusCode).toBe(500)
    expect(store.sendWorkMessage).not.toHaveBeenCalled()
  })

  it('큐 적재에 실패하면 500을 반환한다', async () => {
    vi.mocked(store.sendWorkMessage).mockRejectedValueOnce(new Error('적재 실패'))
    const response = await handler(request())
    expect(response.statusCode).toBe(500)
    expect(store.putReceipt).toHaveBeenCalledTimes(1)
  })

  it('실패 응답에 원문이나 비밀값을 넣지 않는다', async () => {
    vi.mocked(store.putReceipt).mockRejectedValueOnce(new Error('저장 실패'))
    const response = await handler(request())
    expect(response.body).not.toContain(BODY)
    expect(response.body).not.toContain(SIGNING_SECRET)
    expect(response.body).not.toContain(PATH_SECRET)
  })
})
