import { describe, expect, it } from 'vitest'

import { parseEvent } from './event'

const VALID = '{"id":"evt_1","type":"order.created","data":{"total":10}}'

describe('parseEvent', () => {
  it('최소 공통 형식을 통과시킨다', () => {
    expect(parseEvent(VALID)).toEqual({
      ok: true,
      event: { id: 'evt_1', type: 'order.created', data: { total: 10 } },
    })
  })

  it('data가 null이어도 통과시킨다', () => {
    expect(parseEvent('{"id":"e","type":"t","data":null}')).toEqual({
      ok: true,
      event: { id: 'e', type: 't', data: null },
    })
  })

  it('관계없는 필드를 보존하지 않고 정해진 필드만 남긴다', () => {
    const result = parseEvent('{"id":"e","type":"t","data":1,"extra":"버린다"}')
    expect(result).toEqual({ ok: true, event: { id: 'e', type: 't', data: 1 } })
  })

  it('JSON이 아니면 거절한다', () => {
    expect(parseEvent('not json')).toEqual({ ok: false, reason: 'invalid_json' })
  })

  it('빈 본문을 거절한다', () => {
    expect(parseEvent('')).toEqual({ ok: false, reason: 'invalid_json' })
  })

  it('배열을 거절한다', () => {
    expect(parseEvent('[1,2,3]')).toEqual({ ok: false, reason: 'not_an_object' })
  })

  it('원시값을 거절한다', () => {
    expect(parseEvent('"문자열"')).toEqual({ ok: false, reason: 'not_an_object' })
  })

  it('null을 거절한다', () => {
    expect(parseEvent('null')).toEqual({ ok: false, reason: 'not_an_object' })
  })

  it('id가 없으면 거절한다', () => {
    expect(parseEvent('{"type":"t","data":1}')).toEqual({ ok: false, reason: 'invalid_id' })
  })

  it('id가 빈 문자열이면 거절한다', () => {
    expect(parseEvent('{"id":"","type":"t","data":1}')).toEqual({ ok: false, reason: 'invalid_id' })
  })

  it('id가 문자열이 아니면 거절한다', () => {
    expect(parseEvent('{"id":1,"type":"t","data":1}')).toEqual({ ok: false, reason: 'invalid_id' })
  })

  it('type이 없으면 거절한다', () => {
    expect(parseEvent('{"id":"e","data":1}')).toEqual({ ok: false, reason: 'invalid_type' })
  })

  it('type이 빈 문자열이면 거절한다', () => {
    expect(parseEvent('{"id":"e","type":"","data":1}')).toEqual({ ok: false, reason: 'invalid_type' })
  })

  it('data가 없으면 거절한다', () => {
    expect(parseEvent('{"id":"e","type":"t"}')).toEqual({ ok: false, reason: 'missing_data' })
  })
})
