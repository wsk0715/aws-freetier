import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../store')>()),
  listReceipts: vi.fn(),
}))

import * as store from '../store'

import { PAGE_SIZE, handler } from './handler'

const TOKEN = 'query-token'
const KEY = 'rx#2026-10-13T00:00:00.000Z#aaaaaaaa'
const ITEM = { sortKey: KEY, rawBody: '{"a":1}', status: '완료', receivedAt: '2026-10-13T00:00:00.000Z' }

function request(opts: { method?: string; token?: string; cursor?: string } = {}) {
  return {
    requestContext: { http: { method: opts.method ?? 'GET' } },
    headers: opts.token === undefined ? {} : { 'x-inbox-token': opts.token },
    queryStringParameters: opts.cursor === undefined ? undefined : { cursor: opts.cursor },
  }
}

function cursorOf(sortKey: string) {
  return Buffer.from(sortKey).toString('base64url')
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('QUERY_TOKEN', TOKEN)
  vi.mocked(store.listReceipts).mockResolvedValue({ items: [ITEM] })
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
})

describe('메서드', () => {
  it('GET이 아니면 405', async () => {
    expect((await handler(request({ method: 'POST', token: TOKEN }))).statusCode).toBe(405)
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
