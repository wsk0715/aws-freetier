import { parseEvent } from '../rules/event'
import type { BatchResult, QueueEvent, QueueRecord } from '../store'
import {
  claimEventForProcessing,
  getReceipt,
  markEventProcessed,
  publishProcessed,
  setReceiptStatus,
} from '../store'

function receiptKeyOf(body: string): string {
  const parsed: unknown = JSON.parse(body)
  if (parsed === null || typeof parsed !== 'object') throw new Error('작업 메시지가 객체가 아니다')
  const key = (parsed as { receiptKey?: unknown }).receiptKey
  if (typeof key !== 'string' || key.length === 0) throw new Error('작업 메시지에 수신 키가 없다')
  return key
}

async function processRecord(record: QueueRecord): Promise<void> {
  const sortKey = receiptKeyOf(record.body)

  const receipt = await getReceipt(sortKey)
  if (!receipt) {
    console.warn('수신 원본이 없어 건너뛴다')
    return
  }

  const parsed = parseEvent(receipt.rawBody)
  if (!parsed.ok) {
    await setReceiptStatus(sortKey, '실패', parsed.reason)
    throw new Error('이벤트 형식이 맞지 않는다')
  }

  if (!(await claimEventForProcessing(parsed.event, new Date()))) {
    await setReceiptStatus(sortKey, '중복')
    return
  }

  await publishProcessed(parsed.event)
  await markEventProcessed(parsed.event.id, new Date())
  await setReceiptStatus(sortKey, '완료')
}

export const handler = async (event: QueueEvent): Promise<BatchResult> => {
  const batchItemFailures: { itemIdentifier: string }[] = []
  for (const record of event.Records) {
    try {
      await processRecord(record)
    } catch {
      console.error('작업 처리에 실패해 재시도로 넘긴다')
      batchItemFailures.push({ itemIdentifier: record.messageId })
    }
  }
  return { batchItemFailures }
}
