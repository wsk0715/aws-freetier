import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../store')>()),
  receiveDeadLetters: vi.fn(),
  deleteDeadLetter: vi.fn(),
  sendWorkBody: vi.fn(),
  setReceiptStatus: vi.fn(),
  listReceiptStatuses: vi.fn(),
  putSummary: vi.fn(),
}))

import * as store from '../store'

import { handler, previousDay } from './handler'

const RECEIPT_KEY = 'rx#2026-10-14T03:00:00.000Z#aaaaaaaa'
const NOW = new Date('2026-10-15T00:07:00.000Z')

function letter(body: string, receiptHandle = 'h-1') {
  return { receiptHandle, body }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.stubEnv('INBOX_TABLE', 'test-table')
  vi.stubEnv('WORK_QUEUE_URL', 'https://sqs.test/work')
  vi.stubEnv('DLQ_URL', 'https://sqs.test/dlq')
  vi.stubEnv('RETENTION_DAYS', '30')

  vi.mocked(store.receiveDeadLetters).mockResolvedValue([])
  vi.mocked(store.listReceiptStatuses).mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DLQ 재처리', () => {
  it('처음 격리된 건은 재처리 횟수를 붙여 작업 큐로 되돌리고 DLQ에서 지운다', async () => {
    vi.mocked(store.receiveDeadLetters)
      .mockResolvedValueOnce([letter(JSON.stringify({ receiptKey: RECEIPT_KEY }))])
      .mockResolvedValue([])

    await handler()

    expect(store.sendWorkBody).toHaveBeenCalledWith(
      JSON.stringify({ receiptKey: RECEIPT_KEY, redrives: 1 }),
    )
    expect(store.deleteDeadLetter).toHaveBeenCalledWith('h-1')
    expect(store.setReceiptStatus).not.toHaveBeenCalled()
  })

  it('이미 한 번 재처리된 건은 되돌리지 않고 수신 항목을 격리로 표시한다', async () => {
    vi.mocked(store.receiveDeadLetters)
      .mockResolvedValueOnce([letter(JSON.stringify({ receiptKey: RECEIPT_KEY, redrives: 1 }))])
      .mockResolvedValue([])

    await handler()

    expect(store.sendWorkBody).not.toHaveBeenCalled()
    expect(store.setReceiptStatus).toHaveBeenCalledWith(RECEIPT_KEY, '격리')
    expect(store.deleteDeadLetter).toHaveBeenCalledWith('h-1')
  })

  it('형식이 깨진 메시지는 DLQ에서만 지운다', async () => {
    vi.mocked(store.receiveDeadLetters)
      .mockResolvedValueOnce([letter('not json')])
      .mockResolvedValue([])

    await handler()

    expect(store.sendWorkBody).not.toHaveBeenCalled()
    expect(store.setReceiptStatus).not.toHaveBeenCalled()
    expect(store.deleteDeadLetter).toHaveBeenCalledWith('h-1')
  })

  it('DLQ가 빌 때까지 반복해서 꺼낸다', async () => {
    vi.mocked(store.receiveDeadLetters)
      .mockResolvedValueOnce([letter(JSON.stringify({ receiptKey: RECEIPT_KEY }), 'h-1')])
      .mockResolvedValueOnce([letter(JSON.stringify({ receiptKey: RECEIPT_KEY }), 'h-2')])
      .mockResolvedValue([])

    await handler()

    expect(store.sendWorkBody).toHaveBeenCalledTimes(2)
    expect(store.receiveDeadLetters).toHaveBeenCalledTimes(3)
  })

  it('한 번 실행에서 꺼내는 건수에 상한이 있다', async () => {
    const batch = Array.from({ length: 10 }, (_, i) =>
      letter(JSON.stringify({ receiptKey: RECEIPT_KEY }), `h-${i}`),
    )
    vi.mocked(store.receiveDeadLetters).mockResolvedValue(batch)

    await handler()

    expect(store.sendWorkBody).toHaveBeenCalledTimes(100)
  })
})

describe('일일 요약', () => {
  it('전날 수신 항목을 상태별로 세어 저장한다', async () => {
    vi.mocked(store.listReceiptStatuses).mockResolvedValue(['완료', '완료', '실패', '중복'])

    await handler()

    expect(store.listReceiptStatuses).toHaveBeenCalledWith('2026-10-14')
    expect(store.putSummary).toHaveBeenCalledWith(
      '2026-10-14',
      { 완료: 2, 실패: 1, 중복: 1 },
      0,
      0,
      NOW,
    )
  })

  it('재처리·격리 건수를 요약에 함께 남긴다', async () => {
    vi.mocked(store.receiveDeadLetters)
      .mockResolvedValueOnce([
        letter(JSON.stringify({ receiptKey: RECEIPT_KEY }), 'h-1'),
        letter(JSON.stringify({ receiptKey: RECEIPT_KEY, redrives: 1 }), 'h-2'),
      ])
      .mockResolvedValue([])

    await handler()

    expect(store.putSummary).toHaveBeenCalledWith('2026-10-14', {}, 1, 1, NOW)
  })

  it('수신이 없던 날도 빈 요약을 남긴다', async () => {
    await handler()
    expect(store.putSummary).toHaveBeenCalledWith('2026-10-14', {}, 0, 0, NOW)
  })
})

describe('previousDay', () => {
  it('UTC 기준 전날의 날짜 문자열을 만든다', () => {
    expect(previousDay(new Date('2026-10-15T00:07:00.000Z'))).toBe('2026-10-14')
    expect(previousDay(new Date('2026-01-01T00:07:00.000Z'))).toBe('2025-12-31')
  })
})
