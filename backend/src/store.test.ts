import { describe, expect, it } from 'vitest'

import { INBOX_ID, eventKey, expiry, historyKey, receiptKey } from './store'

describe('저장 키', () => {
  it('수신함은 단일 파티션을 쓴다', () => {
    expect(INBOX_ID).toBe('inbox')
  })

  it('수신 항목은 수신 시각 순으로 정렬된다', () => {
    const earlier = receiptKey('2026-10-13T00:00:00.000Z', 'aaaa')
    const later = receiptKey('2026-10-13T00:00:01.000Z', 'aaaa')
    expect(earlier < later).toBe(true)
  })

  it('같은 시각에 도착한 수신 항목도 서로 다르다', () => {
    expect(receiptKey('2026-10-13T00:00:00.000Z', 'aaaa')).not.toBe(
      receiptKey('2026-10-13T00:00:00.000Z', 'bbbb'),
    )
  })

  it('종류마다 다른 접두사를 쓴다', () => {
    expect(receiptKey('2026-10-13T00:00:00.000Z', 'aaaa').startsWith('rx#')).toBe(true)
    expect(eventKey('evt_1').startsWith('evt#')).toBe(true)
    expect(historyKey('evt_1').startsWith('his#')).toBe(true)
  })

  it('이벤트 id가 같으면 이벤트 키와 이력 키가 하나로 모인다', () => {
    expect(eventKey('evt_1')).toBe(eventKey('evt_1'))
    expect(historyKey('evt_1')).toBe(historyKey('evt_1'))
  })
})

describe('expiry', () => {
  it('보존 기간만큼 뒤의 초 단위 시각을 만든다', () => {
    const at = new Date('2026-10-13T00:00:00.000Z')
    expect(expiry(at, 30)).toBe(Math.floor(at.getTime() / 1000) + 30 * 86400)
  })
})
