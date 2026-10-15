import { randomUUID } from 'node:crypto'

import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from '../rules/signature'
import { INBOX_ID, expiry, putReceipt, receiptKey, requiredEnv, sendWorkMessage } from '../store'

export const MAX_BODY_BYTES = 64 * 1024

export type ReceiveRequest = {
  rawPath?: string
  headers?: Record<string, string | undefined>
  body?: string
  isBase64Encoded?: boolean
}

export type ReceiveResponse = { statusCode: number; body: string }

function reply(statusCode: number, payload: Record<string, string>): ReceiveResponse {
  return { statusCode, body: JSON.stringify(payload) }
}

function header(headers: Record<string, string | undefined>, name: string): string | undefined {
  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value
  }
  return undefined
}

function decodeBody(event: ReceiveRequest): string {
  if (!event.isBase64Encoded) return event.body ?? ''
  return Buffer.from(event.body ?? '', 'base64').toString('utf8')
}

export const handler = async (event: ReceiveRequest): Promise<ReceiveResponse> => {
  if (event.rawPath !== `/${requiredEnv('RECEIVE_PATH')}`) return reply(404, { status: 'not_found' })

  const rawBody = decodeBody(event)
  const bodyBytes = Buffer.byteLength(rawBody, 'utf8')
  if (bodyBytes > MAX_BODY_BYTES) return reply(413, { status: 'rejected', reason: 'body_too_large' })

  const headers = event.headers ?? {}
  const verdict = verifySignature({
    secret: requiredEnv('WEBHOOK_SIGNING_SECRET'),
    timestamp: header(headers, TIMESTAMP_HEADER),
    signature: header(headers, SIGNATURE_HEADER),
    body: rawBody,
    nowSeconds: Math.floor(Date.now() / 1000),
  })
  if (!verdict.ok) return reply(401, { status: 'rejected', reason: verdict.reason })

  const receivedAt = new Date()
  const sortKey = receiptKey(receivedAt.toISOString(), randomUUID().slice(0, 8))

  try {
    await putReceipt({
      inboxId: INBOX_ID,
      sortKey,
      status: '수신됨',
      receivedAt: receivedAt.toISOString(),
      rawBody,
      bodyBytes,
      contentType: header(headers, 'content-type') ?? 'application/octet-stream',
      expiresAt: expiry(receivedAt, Number(requiredEnv('RETENTION_DAYS'))),
    })
  } catch {
    console.error('수신 원본 저장에 실패했다')
    return reply(500, { status: 'error' })
  }

  try {
    await sendWorkMessage(sortKey)
  } catch {
    console.error('작업 큐 적재에 실패했다')
    return reply(500, { status: 'error' })
  }

  return reply(202, { status: 'received' })
}
