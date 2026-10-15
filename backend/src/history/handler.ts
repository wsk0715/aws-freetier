import { parseEvent } from '../rules/event'
import type { BatchResult, QueueEvent } from '../store'
import { putHistory } from '../store'

export const handler = async (event: QueueEvent): Promise<BatchResult> => {
  const batchItemFailures: { itemIdentifier: string }[] = []
  for (const record of event.Records) {
    try {
      const parsed = parseEvent(record.body)
      if (!parsed.ok) throw new Error('발행된 이벤트 형식이 맞지 않는다')
      await putHistory(parsed.event, new Date())
    } catch {
      console.error('이력 기록에 실패해 재시도로 넘긴다')
      batchItemFailures.push({ itemIdentifier: record.messageId })
    }
  }
  return { batchItemFailures }
}
