import { createHmac } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { MAX_SKEW_SECONDS, hmacSha256Hex, signingPayload, verifySignature } from './signature'

const SECRET = 'test-secret'
const BODY = '{"id":"evt_1","type":"order.created","data":{}}'
const NOW = 1_700_000_000

function signatureOf(timestamp: number, body: string, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`
}

function verify(overrides: Partial<Parameters<typeof verifySignature>[0]> = {}) {
  return verifySignature({
    secret: SECRET,
    timestamp: String(NOW),
    body: BODY,
    signature: signatureOf(NOW, BODY),
    nowSeconds: NOW,
    ...overrides,
  })
}

describe('hmacSha256Hex', () => {
  it('공개된 시험 벡터와 일치한다', () => {
    expect(hmacSha256Hex('key', 'The quick brown fox jumps over the lazy dog')).toBe(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
    )
  })
})

describe('signingPayload', () => {
  it('타임스탬프와 원문을 마침표로 잇는다', () => {
    expect(signingPayload('123', 'body')).toBe('123.body')
  })
})

describe('verifySignature', () => {
  it('올바른 서명을 통과시킨다', () => {
    expect(verify()).toEqual({ ok: true })
  })

  it('본문이 한 바이트라도 바뀌면 거절한다', () => {
    expect(verify({ body: `${BODY} ` })).toEqual({ ok: false, reason: 'mismatch' })
  })

  it('다른 비밀값으로 만든 서명을 거절한다', () => {
    expect(verify({ secret: 'other-secret' })).toEqual({ ok: false, reason: 'mismatch' })
  })

  it('타임스탬프 헤더가 없으면 거절한다', () => {
    expect(verify({ timestamp: undefined })).toEqual({ ok: false, reason: 'missing_timestamp' })
  })

  it('서명 헤더가 없으면 거절한다', () => {
    expect(verify({ signature: undefined })).toEqual({ ok: false, reason: 'missing_signature' })
  })

  it('타임스탬프가 정수가 아니면 거절한다', () => {
    expect(verify({ timestamp: 'abc' })).toEqual({ ok: false, reason: 'malformed_timestamp' })
  })

  it('알고리즘 접두사가 없으면 거절한다', () => {
    expect(verify({ signature: signatureOf(NOW, BODY).replace('sha256=', '') })).toEqual({
      ok: false,
      reason: 'malformed_signature',
    })
  })

  it('다른 알고리즘을 주장하면 거절한다', () => {
    expect(verify({ signature: signatureOf(NOW, BODY).replace('sha256=', 'sha1=') })).toEqual({
      ok: false,
      reason: 'malformed_signature',
    })
  })

  it('16진수가 아닌 서명을 거절한다', () => {
    expect(verify({ signature: `sha256=${'z'.repeat(64)}` })).toEqual({
      ok: false,
      reason: 'malformed_signature',
    })
  })

  it('길이가 다른 서명을 거절한다', () => {
    expect(verify({ signature: 'sha256=abcd' })).toEqual({ ok: false, reason: 'malformed_signature' })
  })

  it('허용 범위 안의 과거 시각을 통과시킨다', () => {
    const past = NOW - MAX_SKEW_SECONDS
    expect(verify({ timestamp: String(past), signature: signatureOf(past, BODY) })).toEqual({ ok: true })
  })

  it('허용 범위 안의 미래 시각을 통과시킨다', () => {
    const future = NOW + MAX_SKEW_SECONDS
    expect(
      verify({ timestamp: String(future), signature: signatureOf(future, BODY) }),
    ).toEqual({ ok: true })
  })

  it('허용 범위를 넘긴 과거 시각을 거절한다', () => {
    const past = NOW - MAX_SKEW_SECONDS - 1
    expect(verify({ timestamp: String(past), signature: signatureOf(past, BODY) })).toEqual({
      ok: false,
      reason: 'timestamp_out_of_range',
    })
  })

  it('허용 범위를 넘긴 미래 시각을 거절한다', () => {
    const future = NOW + MAX_SKEW_SECONDS + 1
    expect(verify({ timestamp: String(future), signature: signatureOf(future, BODY) })).toEqual({
      ok: false,
      reason: 'timestamp_out_of_range',
    })
  })

  it('서명이 맞아도 범위를 벗어나면 거절한다', () => {
    const past = NOW - MAX_SKEW_SECONDS - 1
    expect(verify({ timestamp: String(past), signature: signatureOf(past, BODY) })).not.toEqual({ ok: true })
  })
})
