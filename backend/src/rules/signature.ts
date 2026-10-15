import { createHmac, timingSafeEqual } from 'node:crypto'

export const TIMESTAMP_HEADER = 'x-webhook-timestamp'
export const SIGNATURE_HEADER = 'x-webhook-signature'
export const MAX_SKEW_SECONDS = 300

const SIGNATURE_PREFIX = 'sha256='
const HEX_64 = /^[0-9a-f]{64}$/
const UNIX_SECONDS = /^\d+$/

export type SignatureRejection =
  | 'missing_timestamp'
  | 'missing_signature'
  | 'malformed_timestamp'
  | 'malformed_signature'
  | 'timestamp_out_of_range'
  | 'mismatch'

export type SignatureResult = { ok: true } | { ok: false; reason: SignatureRejection }

export function hmacSha256Hex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex')
}

export function signingPayload(timestamp: string, body: string): string {
  return `${timestamp}.${body}`
}

export function verifySignature(input: {
  secret: string
  timestamp: string | undefined
  body: string
  signature: string | undefined
  nowSeconds: number
}): SignatureResult {
  const { timestamp, signature, body, secret, nowSeconds } = input

  if (timestamp === undefined) return { ok: false, reason: 'missing_timestamp' }
  if (signature === undefined) return { ok: false, reason: 'missing_signature' }
  if (!UNIX_SECONDS.test(timestamp)) return { ok: false, reason: 'malformed_timestamp' }

  if (!signature.startsWith(SIGNATURE_PREFIX)) return { ok: false, reason: 'malformed_signature' }
  const presented = signature.slice(SIGNATURE_PREFIX.length)
  if (!HEX_64.test(presented)) return { ok: false, reason: 'malformed_signature' }

  const skew = Math.abs(nowSeconds - Number(timestamp))
  if (skew > MAX_SKEW_SECONDS) return { ok: false, reason: 'timestamp_out_of_range' }

  const expected = hmacSha256Hex(secret, signingPayload(timestamp, body))
  if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(presented, 'hex'))) {
    return { ok: false, reason: 'mismatch' }
  }
  return { ok: true }
}
