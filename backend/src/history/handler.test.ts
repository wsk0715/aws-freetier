import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../store')>()),
  putHistory: vi.fn(),
}))

import * as store from '../store'

import { handler } from './handler'

const VALID = '{"id":"evt_1","type":"order.created","data":{"total":10}}'

function notification(...messages: string[]) {
  return { Records: messages.map((Message) => ({ Sns: { Message } })) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('INBOX_TABLE', 'test-table')
  vi.stubEnv('RETENTION_DAYS', '30')
})

describe('이력 기록', () => {
  it('발행된 이벤트를 이력으로 저장한다', async () => {
    await handler(notification(VALID))

    expect(store.putHistory).toHaveBeenCalledWith(
      { id: 'evt_1', type: 'order.created', data: { total: 10 } },
      expect.any(Date),
    )
  })

  it('같은 이벤트가 다시 와도 같은 키로 덮어쓴다', async () => {
    await handler(notification(VALID))
    await handler(notification(VALID))

    const keys = vi.mocked(store.putHistory).mock.calls.map((call) => store.historyKey(call[0].id))
    expect(new Set(keys).size).toBe(1)
    expect(store.putHistory).toHaveBeenCalledTimes(2)
  })
})

describe('실패 재시도', () => {
  it('형식이 맞지 않으면 저장하지 않고 예외로 재시도를 요청한다', async () => {
    await expect(handler(notification('not json'))).rejects.toThrow()
    expect(store.putHistory).not.toHaveBeenCalled()
  })

  it('저장에 실패하면 예외로 재시도를 요청한다', async () => {
    vi.mocked(store.putHistory).mockRejectedValueOnce(new Error('저장 실패'))
    await expect(handler(notification(VALID))).rejects.toThrow()
  })

  it('한 호출의 여러 메시지 중 하나라도 실패하면 나머지를 저장한 뒤 예외를 던진다', async () => {
    await expect(handler(notification('not json', VALID))).rejects.toThrow()
    expect(store.putHistory).toHaveBeenCalledTimes(1)
  })
})
