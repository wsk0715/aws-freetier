import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns'
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs'
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'

import type { NormalizedEvent } from './rules/event'

export const INBOX_ID = 'inbox'

export type QueueRecord = { messageId: string; body: string }
export type QueueEvent = { Records: QueueRecord[] }
export type BatchResult = { batchItemFailures: { itemIdentifier: string }[] }

export type ReceiptItem = {
  sortKey: string
  rawBody: string
  status: string
  receivedAt: string
}

export function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`환경변수 ${name}이 없다`)
  return value
}

export function receiptKey(receivedAt: string, suffix: string): string {
  return `rx#${receivedAt}#${suffix}`
}

export function eventKey(eventId: string): string {
  return `evt#${eventId}`
}

export function historyKey(eventId: string): string {
  return `his#${eventId}`
}

export function summaryKey(day: string): string {
  return `sum#${day}`
}

export type DeadLetter = { receiptHandle: string; body: string }

export function expiry(at: Date, retentionDays: number): number {
  return Math.floor(at.getTime() / 1000) + retentionDays * 86400
}

function retentionDays(): number {
  return Number(requiredEnv('RETENTION_DAYS'))
}

let document: DynamoDBDocumentClient | undefined
let sns: SNSClient | undefined
let sqs: SQSClient | undefined

function db(): DynamoDBDocumentClient {
  document ??= DynamoDBDocumentClient.from(new DynamoDBClient({}))
  return document
}

function table(): string {
  return requiredEnv('INBOX_TABLE')
}

export async function putReceipt(item: {
  inboxId: string
  sortKey: string
  status: string
  receivedAt: string
  rawBody: string
  bodyBytes: number
  contentType: string
  expiresAt: number
}): Promise<void> {
  await db().send(new PutCommand({ TableName: table(), Item: { ...item } }))
}

export async function getReceipt(sortKey: string): Promise<ReceiptItem | undefined> {
  const result = await db().send(
    new GetCommand({
      TableName: table(),
      Key: { inboxId: INBOX_ID, sortKey },
      ProjectionExpression: 'sortKey, rawBody, #status, receivedAt',
      ExpressionAttributeNames: { '#status': 'status' },
    }),
  )
  return result.Item as ReceiptItem | undefined
}

export async function setReceiptStatus(
  sortKey: string,
  status: string,
  reason?: string,
): Promise<void> {
  const withReason = reason !== undefined
  await db().send(
    new UpdateCommand({
      TableName: table(),
      Key: { inboxId: INBOX_ID, sortKey },
      UpdateExpression: withReason
        ? 'SET #status = :status, failureReason = :reason'
        : 'SET #status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: withReason
        ? { ':status': status, ':reason': reason }
        : { ':status': status },
    }),
  )
}

export async function claimEventForProcessing(event: NormalizedEvent, at: Date): Promise<boolean> {
  const now = at.toISOString()
  try {
    await db().send(
      new UpdateCommand({
        TableName: table(),
        Key: { inboxId: INBOX_ID, sortKey: eventKey(event.id) },
        UpdateExpression:
          'SET #status = :processing, #type = :type, #data = :data, ' +
          'firstSeenAt = if_not_exists(firstSeenAt, :now), lastSeenAt = :now, expiresAt = :expiresAt',
        ConditionExpression: 'attribute_not_exists(sortKey) OR #status <> :done',
        ExpressionAttributeNames: { '#status': 'status', '#type': 'type', '#data': 'data' },
        ExpressionAttributeValues: {
          ':processing': '처리중',
          ':done': '완료',
          ':type': event.type,
          ':data': event.data,
          ':now': now,
          ':expiresAt': expiry(at, retentionDays()),
        },
      }),
    )
    return true
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return false
    throw error
  }
}

export async function markEventProcessed(eventId: string, at: Date): Promise<void> {
  await db().send(
    new UpdateCommand({
      TableName: table(),
      Key: { inboxId: INBOX_ID, sortKey: eventKey(eventId) },
      UpdateExpression: 'SET #status = :done, processedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':done': '완료', ':now': at.toISOString() },
    }),
  )
}

export async function sendWorkMessage(receiptSortKey: string): Promise<void> {
  sqs ??= new SQSClient({})
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: requiredEnv('WORK_QUEUE_URL'),
      MessageBody: JSON.stringify({ receiptKey: receiptSortKey }),
    }),
  )
}

export async function sendWorkBody(body: string): Promise<void> {
  sqs ??= new SQSClient({})
  await sqs.send(new SendMessageCommand({ QueueUrl: requiredEnv('WORK_QUEUE_URL'), MessageBody: body }))
}

export async function receiveDeadLetters(): Promise<DeadLetter[]> {
  sqs ??= new SQSClient({})
  const result = await sqs.send(
    new ReceiveMessageCommand({ QueueUrl: requiredEnv('DLQ_URL'), MaxNumberOfMessages: 10 }),
  )
  return (result.Messages ?? []).flatMap((m) =>
    m.ReceiptHandle && m.Body !== undefined ? [{ receiptHandle: m.ReceiptHandle, body: m.Body }] : [],
  )
}

export async function deleteDeadLetter(receiptHandle: string): Promise<void> {
  sqs ??= new SQSClient({})
  await sqs.send(
    new DeleteMessageCommand({ QueueUrl: requiredEnv('DLQ_URL'), ReceiptHandle: receiptHandle }),
  )
}

export async function listReceiptStatuses(day: string): Promise<string[]> {
  const statuses: string[] = []
  let startKey: Record<string, unknown> | undefined
  do {
    const result = await db().send(
      new QueryCommand({
        TableName: table(),
        KeyConditionExpression: 'inboxId = :inbox AND begins_with(sortKey, :prefix)',
        ProjectionExpression: '#status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':inbox': INBOX_ID, ':prefix': `rx#${day}` },
        ExclusiveStartKey: startKey,
      }),
    )
    for (const item of result.Items ?? []) statuses.push(String(item.status))
    startKey = result.LastEvaluatedKey
  } while (startKey)
  return statuses
}

export async function putSummary(
  day: string,
  counts: Record<string, number>,
  redriven: number,
  quarantined: number,
  at: Date,
): Promise<void> {
  await db().send(
    new PutCommand({
      TableName: table(),
      Item: {
        inboxId: INBOX_ID,
        sortKey: summaryKey(day),
        day,
        counts,
        redriven,
        quarantined,
        summarizedAt: at.toISOString(),
        expiresAt: expiry(at, retentionDays()),
      },
    }),
  )
}

export async function publishProcessed(event: NormalizedEvent): Promise<void> {
  sns ??= new SNSClient({})
  await sns.send(
    new PublishCommand({
      TopicArn: requiredEnv('PROCESSED_TOPIC_ARN'),
      Message: JSON.stringify(event),
    }),
  )
}

export async function putHistory(event: NormalizedEvent, at: Date): Promise<void> {
  await db().send(
    new PutCommand({
      TableName: table(),
      Item: {
        inboxId: INBOX_ID,
        sortKey: historyKey(event.id),
        eventId: event.id,
        type: event.type,
        data: event.data,
        deliveredAt: at.toISOString(),
        expiresAt: expiry(at, retentionDays()),
      },
    }),
  )
}
