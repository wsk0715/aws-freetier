import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../store')>()),
  getReceipt: vi.fn(),
  setReceiptStatus: vi.fn(),
  claimEventForProcessing: vi.fn(),
  markEventProcessed: vi.fn(),
  publishProcessed: vi.fn(),
}))

import * as store from '../store'

import { handler } from './handler'

const RECEIPT_KEY = 'rx#2026-10-13T00:00:00.000Z#aaaaaaaa'
const OTHER_RECEIPT_KEY = 'rx#2026-10-13T00:00:01.000Z#bbbbbbbb'
const VALID = '{"id":"evt_1","type":"order.created","data":{"total":10}}'

const processed = new Set<string>()

function record(body: string, messageId = 'msg-1') {
  return { messageId, body: JSON.stringify({ receiptKey: body }) }
}

function receipt(rawBody: string) {
  return { sortKey: RECEIPT_KEY, rawBody, status: '수신됨', receivedAt: '2026-10-13T00:00:00.000Z' }
}

beforeEach(() => {
  vi.clearAllMocks()
  processed.clear()
  vi.stubEnv('INBOX_TABLE', 'test-table')
  vi.stubEnv('PROCESSED_TOPIC_ARN', 'arn:aws:sns:ap-northeast-2:000000000000:test')
  vi.stubEnv('RETENTION_DAYS', '30')

  vi.mocked(store.getReceipt).mockResolvedValue(receipt(VALID))
  vi.mocked(store.claimEventForProcessing).mockImplementation(async (event) => !processed.has(event.id))
  vi.mocked(store.markEventProcessed).mockImplementation(async (eventId) => {
    processed.add(eventId)
  })
})

describe('정상 처리', () => {
  it('변환한 이벤트를 발행하고 수신 항목을 완료로 바꾼다', async () => {
    const result = await handler({ Records: [record(RECEIPT_KEY)] })

    expect(result.batchItemFailures).toEqual([])
    expect(store.publishProcessed).toHaveBeenCalledTimes(1)
    expect(store.publishProcessed).toHaveBeenCalledWith({
      id: 'evt_1',
      type: 'order.created',
      data: { total: 10 },
    })
    expect(store.markEventProcessed).toHaveBeenCalledWith('evt_1', expect.any(Date))
    expect(store.setReceiptStatus).toHaveBeenCalledWith(RECEIPT_KEY, '완료')
  })

  it('저장된 원문을 다시 읽어 변환한다', async () => {
    await handler({ Records: [record(RECEIPT_KEY)] })
    expect(store.getReceipt).toHaveBeenCalledWith(RECEIPT_KEY)
  })
})

describe('중복 판정', () => {
  it('이미 완료된 이벤트는 다시 발행하지 않고 수신 항목을 중복으로 표시한다', async () => {
    await handler({ Records: [record(RECEIPT_KEY)] })
    vi.clearAllMocks()
    vi.mocked(store.getReceipt).mockResolvedValue(receipt(VALID))

    const result = await handler({ Records: [record(RECEIPT_KEY, 'msg-2')] })

    expect(result.batchItemFailures).toEqual([])
    expect(store.publishProcessed).not.toHaveBeenCalled()
    expect(store.setReceiptStatus).toHaveBeenCalledWith(RECEIPT_KEY, '중복')
  })

  it('같은 이벤트가 다른 수신 항목으로 두 번 와도 한 번만 발행한다', async () => {
    await handler({ Records: [record(RECEIPT_KEY)] })
    vi.mocked(store.getReceipt).mockResolvedValue(receipt(VALID))

    await handler({ Records: [record(OTHER_RECEIPT_KEY, 'msg-2')] })

    expect(store.publishProcessed).toHaveBeenCalledTimes(1)
  })
})

describe('실패 격리', () => {
  it('변환할 수 없는 원문은 실패 목록에 넣고 발행하지 않는다', async () => {
    vi.mocked(store.getReceipt).mockResolvedValue(receipt('not json'))

    const result = await handler({ Records: [record(RECEIPT_KEY)] })

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-1' }])
    expect(store.publishProcessed).not.toHaveBeenCalled()
    expect(store.setReceiptStatus).toHaveBeenCalledWith(RECEIPT_KEY, '실패', 'invalid_json')
  })

  it('필드가 빠진 이벤트는 실패 목록에 넣는다', async () => {
    vi.mocked(store.getReceipt).mockResolvedValue(receipt('{"type":"order.created","data":1}'))

    const result = await handler({ Records: [record(RECEIPT_KEY)] })

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-1' }])
    expect(store.setReceiptStatus).toHaveBeenCalledWith(RECEIPT_KEY, '실패', 'invalid_id')
  })

  it('발행에 실패하면 실패 목록에 넣어 재시도시킨다', async () => {
    vi.mocked(store.publishProcessed).mockRejectedValueOnce(new Error('발행 실패'))

    const result = await handler({ Records: [record(RECEIPT_KEY)] })

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-1' }])
    expect(store.setReceiptStatus).not.toHaveBeenCalledWith(RECEIPT_KEY, '완료')
  })

  it('재시도에서 다시 발행한다', async () => {
    vi.mocked(store.publishProcessed).mockRejectedValueOnce(new Error('발행 실패'))
    await handler({ Records: [record(RECEIPT_KEY)] })

    await handler({ Records: [record(RECEIPT_KEY)] })

    expect(store.publishProcessed).toHaveBeenCalledTimes(2)
  })

  it('수신 원본이 없으면 실패 목록에 넣지 않는다', async () => {
    vi.mocked(store.getReceipt).mockResolvedValue(undefined)

    expect((await handler({ Records: [record(RECEIPT_KEY)] })).batchItemFailures).toEqual([])
  })

  it('작업 메시지 형식이 깨졌으면 실패 목록에 넣는다', async () => {
    const result = await handler({ Records: [{ messageId: 'msg-1', body: 'not json' }] })
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-1' }])
  })

  it('한 배치에서 실패한 메시지만 실패 목록에 넣는다', async () => {
    vi.mocked(store.getReceipt).mockImplementation(async (key) =>
      key === RECEIPT_KEY ? receipt('not json') : receipt(VALID),
    )

    const result = await handler({
      Records: [record(RECEIPT_KEY, 'msg-1'), record(OTHER_RECEIPT_KEY, 'msg-2')],
    })

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-1' }])
    expect(store.publishProcessed).toHaveBeenCalledTimes(1)
  })
})

describe('로그 위생', () => {
  it('실패해도 예외를 밖으로 던지지 않는다', async () => {
    vi.mocked(store.getReceipt).mockRejectedValueOnce(new Error('조회 실패'))
    const result = await handler({ Records: [record(RECEIPT_KEY)] })
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-1' }])
  })
})
