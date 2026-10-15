import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../store')>()),
  putHistory: vi.fn(),
}))

import * as store from '../store'

import { handler } from './handler'

const VALID = '{"id":"evt_1","type":"order.created","data":{"total":10}}'

function record(body: string, messageId = 'msg-1') {
  return { messageId, body }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('INBOX_TABLE', 'test-table')
  vi.stubEnv('RETENTION_DAYS', '30')
})

describe('이력 기록', () => {
  it('발행된 이벤트를 이력으로 저장한다', async () => {
    const result = await handler({ Records: [record(VALID)] })

    expect(result.batchItemFailures).toEqual([])
    expect(store.putHistory).toHaveBeenCalledWith(
      { id: 'evt_1', type: 'order.created', data: { total: 10 } },
      expect.any(Date),
    )
  })

  it('같은 이벤트가 다시 와도 같은 키로 덮어쓴다', async () => {
    await handler({ Records: [record(VALID, 'msg-1')] })
    await handler({ Records: [record(VALID, 'msg-2')] })

    const keys = vi.mocked(store.putHistory).mock.calls.map((call) => store.historyKey(call[0].id))
    expect(new Set(keys).size).toBe(1)
    expect(store.putHistory).toHaveBeenCalledTimes(2)
  })
})

describe('실패 격리', () => {
  it('형식이 맞지 않으면 저장하지 않고 실패 목록에 넣는다', async () => {
    const result = await handler({ Records: [record('not json')] })

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-1' }])
    expect(store.putHistory).not.toHaveBeenCalled()
  })

  it('저장에 실패하면 실패 목록에 넣는다', async () => {
    vi.mocked(store.putHistory).mockRejectedValueOnce(new Error('저장 실패'))

    const result = await handler({ Records: [record(VALID)] })

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-1' }])
  })

  it('한 배치에서 실패한 메시지만 실패 목록에 넣는다', async () => {
    const result = await handler({
      Records: [record('not json', 'msg-1'), record(VALID, 'msg-2')],
    })

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-1' }])
    expect(store.putHistory).toHaveBeenCalledTimes(1)
  })
})
