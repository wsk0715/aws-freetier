import { timingSafeEqual } from 'node:crypto'

import type { ReceiptItem } from '../store'
import { listReceipts, requiredEnv } from '../store'

export const PAGE_SIZE = 20

export type QueryRequest = {
  requestContext?: { http?: { method?: string } }
  headers?: Record<string, string | undefined>
  queryStringParameters?: Record<string, string | undefined>
}

export type QueryResponse = {
  statusCode: number
  headers: Record<string, string>
  body: string
}

export type InboxItem = { key: string; receivedAt: string; status: string; rawBody: string }

function reply(statusCode: number, payload: unknown): QueryResponse {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }
}

function tokenMatches(given: string | undefined): boolean {
  if (given === undefined) return false
  const a = Buffer.from(given)
  const b = Buffer.from(requiredEnv('QUERY_TOKEN'))
  return a.length === b.length && timingSafeEqual(a, b)
}

function toInboxItem(item: ReceiptItem): InboxItem | undefined {
  const { sortKey, receivedAt, status, rawBody } = item
  if ([sortKey, receivedAt, status, rawBody].some((v) => typeof v !== 'string')) return undefined
  return { key: sortKey, receivedAt, status, rawBody }
}

export const handler = async (event: QueryRequest): Promise<QueryResponse> => {
  // Function URL은 헤더 이름을 소문자로 넘긴다.
  if (!tokenMatches(event.headers?.['x-inbox-token'])) return reply(401, { status: 'unauthorized' })
  if (event.requestContext?.http?.method !== 'GET') return reply(405, { status: 'method_not_allowed' })

  const cursor = event.queryStringParameters?.cursor
  const startSortKey = cursor === undefined ? undefined : Buffer.from(cursor, 'base64url').toString()
  if (startSortKey !== undefined && !startSortKey.startsWith('rx#')) {
    return reply(400, { status: 'bad_cursor' })
  }

  try {
    const page = await listReceipts(PAGE_SIZE, startSortKey)
    const items = page.items.flatMap((item) => {
      const mapped = toInboxItem(item)
      if (!mapped) console.error('형식이 맞지 않는 수신 항목을 건너뛴다')
      return mapped ? [mapped] : []
    })
    return reply(200, {
      items,
      ...(page.lastSortKey ? { nextCursor: Buffer.from(page.lastSortKey).toString('base64url') } : {}),
    })
  } catch {
    console.error('수신 목록 조회에 실패했다')
    return reply(500, { status: 'error' })
  }
}
