import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../store')>()),
  listReceipts: vi.fn(),
  listSummaries: vi.fn(),
  requeueReceipt: vi.fn(),
  sendWorkBody: vi.fn(),
  setReceiptStatus: vi.fn(),
}))

vi.mock('./auth', () => ({ verifyIdToken: vi.fn() }))

import * as store from '../store'

import { verifyIdToken } from './auth'

import { PAGE_SIZE, SUMMARY_DAYS, handler } from './handler'

const TOKEN = 'id-token'
const KEY = 'rx#2026-10-13T00:00:00.000Z#aaaaaaaa'
const ITEM = { sortKey: KEY, rawBody: '{"a":1}', status: '완료', receivedAt: '2026-10-13T00:00:00.000Z' }

function request(
  opts: { method?: string; path?: string; token?: string; cursor?: string; body?: string; base64?: boolean } = {},
) {
  return {
    rawPath: opts.path ?? '/',
    requestContext: { http: { method: opts.method ?? 'GET' } },
    headers: opts.token === undefined ? {} : { authorization: `Bearer ${opts.token}` },
    queryStringParameters: opts.cursor === undefined ? undefined : { cursor: opts.cursor },
    body: opts.body,
    isBase64Encoded: opts.base64 ?? false,
  }
}

function reprocess(body: unknown) {
  return request({ method: 'POST', path: '/reprocess', token: TOKEN, body: JSON.stringify(body) })
}

function cursorOf(sortKey: string) {
  return Buffer.from(sortKey).toString('base64url')
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(verifyIdToken).mockImplementation(async (token) => token === TOKEN)
  vi.mocked(store.listReceipts).mockResolvedValue({ items: [ITEM] })
  vi.mocked(store.listSummaries).mockResolvedValue([])
  vi.mocked(store.requeueReceipt).mockResolvedValue(true)
})

describe('토큰', () => {
  it('토큰이 없으면 401', async () => {
    expect((await handler(request())).statusCode).toBe(401)
    expect(store.listReceipts).not.toHaveBeenCalled()
  })

  it('토큰이 틀리면 401', async () => {
    expect((await handler(request({ token: 'wrong' }))).statusCode).toBe(401)
    expect(store.listReceipts).not.toHaveBeenCalled()
  })

  it('재처리 요청도 토큰이 없으면 401이고 아무것도 바꾸지 않는다', async () => {
    const res = await handler(request({ method: 'POST', path: '/reprocess', body: JSON.stringify({ key: KEY }) }))
    expect(res.statusCode).toBe(401)
    expect(store.requeueReceipt).not.toHaveBeenCalled()
    expect(store.sendWorkBody).not.toHaveBeenCalled()
  })

  it('Bearer 형식이 아니면 검증하지 않고 401', async () => {
    const res = await handler({ ...request(), headers: { authorization: TOKEN } })
    expect(res.statusCode).toBe(401)
    expect(verifyIdToken).not.toHaveBeenCalled()
  })

  it('서명 키를 받지 못하면 500', async () => {
    vi.mocked(verifyIdToken).mockRejectedValueOnce(new Error('JWKS'))
    expect((await handler(request({ token: TOKEN }))).statusCode).toBe(500)
    expect(store.listReceipts).not.toHaveBeenCalled()
  })
})

describe('경로와 메서드', () => {
  it('목록 경로에 GET이 아니면 405', async () => {
    expect((await handler(request({ method: 'POST', token: TOKEN }))).statusCode).toBe(405)
  })

  it('재처리 경로에 POST가 아니면 405', async () => {
    expect((await handler(request({ path: '/reprocess', token: TOKEN }))).statusCode).toBe(405)
  })

  it('알 수 없는 경로는 404', async () => {
    expect((await handler(request({ path: '/nope', token: TOKEN }))).statusCode).toBe(404)
  })
})

describe('목록', () => {
  it('수신 항목을 돌려준다', async () => {
    const res = await handler(request({ token: TOKEN }))
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({
      items: [{ key: KEY, receivedAt: ITEM.receivedAt, status: '완료', rawBody: '{"a":1}' }],
    })
    expect(store.listReceipts).toHaveBeenCalledWith(PAGE_SIZE, undefined)
  })

  it('실패 사유와 수동 재처리 기록이 있으면 함께 돌려준다', async () => {
    vi.mocked(store.listReceipts).mockResolvedValue({
      items: [
        {
          ...ITEM,
          status: '격리',
          failureReason: 'invalid_type',
          requeueCount: 2,
          requeuedAt: '2026-10-14T00:00:00.000Z',
        },
      ],
    })
    const res = await handler(request({ token: TOKEN }))
    expect(JSON.parse(res.body).items[0]).toMatchObject({
      failureReason: 'invalid_type',
      requeueCount: 2,
      requeuedAt: '2026-10-14T00:00:00.000Z',
    })
  })

  it('결과가 없으면 빈 목록', async () => {
    vi.mocked(store.listReceipts).mockResolvedValue({ items: [] })
    const res = await handler(request({ token: TOKEN }))
    expect(JSON.parse(res.body)).toEqual({ items: [] })
  })

  it('손상된 항목은 건너뛰고 나머지를 돌려준다', async () => {
    vi.mocked(store.listReceipts).mockResolvedValue({
      items: [{ sortKey: 'rx#broken' } as never, ITEM],
    })
    const res = await handler(request({ token: TOKEN }))
    expect(JSON.parse(res.body).items).toHaveLength(1)
  })

  it('저장소 오류는 500', async () => {
    vi.mocked(store.listReceipts).mockRejectedValue(new Error('down'))
    expect((await handler(request({ token: TOKEN }))).statusCode).toBe(500)
  })
})

describe('페이지', () => {
  it('다음 페이지가 있으면 커서를 준다', async () => {
    vi.mocked(store.listReceipts).mockResolvedValue({ items: [ITEM], lastSortKey: KEY })
    const res = await handler(request({ token: TOKEN }))
    expect(JSON.parse(res.body).nextCursor).toBe(cursorOf(KEY))
  })

  it('커서로 이어서 조회한다', async () => {
    await handler(request({ token: TOKEN, cursor: cursorOf(KEY) }))
    expect(store.listReceipts).toHaveBeenCalledWith(PAGE_SIZE, KEY)
  })

  it('수신 항목 키가 아닌 커서는 400', async () => {
    const res = await handler(request({ token: TOKEN, cursor: cursorOf('evt#1') }))
    expect(res.statusCode).toBe(400)
    expect(store.listReceipts).not.toHaveBeenCalled()
  })
})

describe('일일 요약', () => {
  it('최근 요약을 최신순으로 돌려준다', async () => {
    const summary = {
      day: '2026-10-14',
      counts: { 완료: 3, 격리: 1 },
      redriven: 1,
      quarantined: 1,
      summarizedAt: '2026-10-15T00:07:00.000Z',
    }
    vi.mocked(store.listSummaries).mockResolvedValue([summary])
    const res = await handler(request({ path: '/summaries', token: TOKEN }))
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ summaries: [summary] })
    expect(store.listSummaries).toHaveBeenCalledWith(SUMMARY_DAYS)
  })

  it('저장소 오류는 500', async () => {
    vi.mocked(store.listSummaries).mockRejectedValue(new Error('down'))
    expect((await handler(request({ path: '/summaries', token: TOKEN }))).statusCode).toBe(500)
  })
})

describe('수동 재처리', () => {
  it('격리된 건을 수신됨으로 되돌리고 자동 재처리 없이 작업 큐에 다시 넣는다', async () => {
    const res = await handler(reprocess({ key: KEY }))
    expect(res.statusCode).toBe(202)
    expect(store.requeueReceipt).toHaveBeenCalledWith(KEY, expect.any(Date))
    expect(store.sendWorkBody).toHaveBeenCalledWith(JSON.stringify({ receiptKey: KEY, redrives: 1 }))
  })

  it('base64로 온 본문도 읽는다', async () => {
    const body = Buffer.from(JSON.stringify({ key: KEY })).toString('base64')
    const res = await handler(request({ method: 'POST', path: '/reprocess', token: TOKEN, body, base64: true }))
    expect(res.statusCode).toBe(202)
  })

  it('격리 상태가 아니면 409이고 큐에 넣지 않는다', async () => {
    vi.mocked(store.requeueReceipt).mockResolvedValue(false)
    const res = await handler(reprocess({ key: KEY }))
    expect(res.statusCode).toBe(409)
    expect(store.sendWorkBody).not.toHaveBeenCalled()
  })

  it('본문이 JSON이 아니면 400', async () => {
    const res = await handler(request({ method: 'POST', path: '/reprocess', token: TOKEN, body: 'nope' }))
    expect(res.statusCode).toBe(400)
    expect(store.requeueReceipt).not.toHaveBeenCalled()
  })

  it('수신 항목 키가 아니면 400', async () => {
    expect((await handler(reprocess({ key: 'evt#1' }))).statusCode).toBe(400)
    expect((await handler(reprocess({}))).statusCode).toBe(400)
    expect(store.requeueReceipt).not.toHaveBeenCalled()
  })

  it('큐 적재에 실패하면 격리 상태로 되돌리고 500', async () => {
    vi.mocked(store.sendWorkBody).mockRejectedValue(new Error('down'))
    const res = await handler(reprocess({ key: KEY }))
    expect(res.statusCode).toBe(500)
    expect(store.setReceiptStatus).toHaveBeenCalledWith(KEY, '격리')
  })

  it('상태 변경에 실패하면 500이고 큐에 넣지 않는다', async () => {
    vi.mocked(store.requeueReceipt).mockRejectedValue(new Error('down'))
    const res = await handler(reprocess({ key: KEY }))
    expect(res.statusCode).toBe(500)
    expect(store.sendWorkBody).not.toHaveBeenCalled()
  })
})
