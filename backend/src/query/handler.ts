import { timingSafeEqual } from 'node:crypto'

import type { ReceiptItem } from '../store'
import {
  listReceipts,
  listSummaries,
  requeueReceipt,
  requiredEnv,
  sendWorkBody,
  setReceiptStatus,
} from '../store'

export const PAGE_SIZE = 20
export const SUMMARY_DAYS = 7

export type QueryRequest = {
  rawPath?: string
  requestContext?: { http?: { method?: string } }
  headers?: Record<string, string | undefined>
  queryStringParameters?: Record<string, string | undefined>
  body?: string
  isBase64Encoded?: boolean
}

export type QueryResponse = {
  statusCode: number
  headers: Record<string, string>
  body: string
}

export type InboxItem = {
  key: string
  receivedAt: string
  status: string
  rawBody: string
  failureReason?: string
  requeueCount?: number
  requeuedAt?: string
}

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
  const { sortKey, receivedAt, status, rawBody, failureReason, requeueCount, requeuedAt } = item
  if ([sortKey, receivedAt, status, rawBody].some((v) => typeof v !== 'string')) return undefined
  return {
    key: sortKey,
    receivedAt,
    status,
    rawBody,
    ...(typeof failureReason === 'string' ? { failureReason } : {}),
    ...(typeof requeueCount === 'number' ? { requeueCount } : {}),
    ...(typeof requeuedAt === 'string' ? { requeuedAt } : {}),
  }
}

async function listInbox(event: QueryRequest): Promise<QueryResponse> {
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

async function summaries(): Promise<QueryResponse> {
  try {
    return reply(200, { summaries: await listSummaries(SUMMARY_DAYS) })
  } catch {
    console.error('일일 요약 조회에 실패했다')
    return reply(500, { status: 'error' })
  }
}

function requestedKey(event: QueryRequest): string | undefined {
  const raw = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : (event.body ?? '')
  try {
    const parsed: unknown = JSON.parse(raw)
    const key = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).key : undefined
    return typeof key === 'string' && key.startsWith('rx#') ? key : undefined
  } catch {
    return undefined
  }
}

async function reprocess(event: QueryRequest): Promise<QueryResponse> {
  const key = requestedKey(event)
  if (!key) return reply(400, { status: 'bad_request' })

  try {
    if (!(await requeueReceipt(key, new Date()))) return reply(409, { status: 'not_quarantined' })
  } catch {
    console.error('수동 재처리 상태 변경에 실패했다')
    return reply(500, { status: 'error' })
  }

  try {
    // 수동 재처리는 자동 재처리를 다시 거치지 않는다. 또 실패하면 다음 운영 실행에서 격리된다.
    await sendWorkBody(JSON.stringify({ receiptKey: key, redrives: 1 }))
  } catch {
    console.error('수동 재처리 큐 적재에 실패했다')
    try {
      await setReceiptStatus(key, '격리')
    } catch {
      console.error('격리 상태 복구에 실패했다')
    }
    return reply(500, { status: 'error' })
  }
  return reply(202, { status: 'requeued' })
}

export const handler = async (event: QueryRequest): Promise<QueryResponse> => {
  // Function URL은 헤더 이름을 소문자로 넘긴다.
  if (!tokenMatches(event.headers?.['x-inbox-token'])) return reply(401, { status: 'unauthorized' })

  const method = event.requestContext?.http?.method
  const route = { '/': ['GET', listInbox], '/summaries': ['GET', summaries], '/reprocess': ['POST', reprocess] } as const
  const target = route[(event.rawPath ?? '/') as keyof typeof route]
  if (!target) return reply(404, { status: 'not_found' })
  if (method !== target[0]) return reply(405, { status: 'method_not_allowed' })
  return target[1](event)
}
