import { parseEvent } from '../rules/event'
import { putHistory } from '../store'

export type NotificationEvent = { Records: { Sns: { Message: string } }[] }

// SNS가 비동기로 호출한다. 예외를 던지면 Lambda가 재시도하고, 재시도가 끝나면 실패 대상 큐로 보낸다.
export const handler = async (event: NotificationEvent): Promise<void> => {
  let failed = 0
  for (const record of event.Records) {
    try {
      const parsed = parseEvent(record.Sns.Message)
      if (!parsed.ok) throw new Error('발행된 이벤트 형식이 맞지 않는다')
      await putHistory(parsed.event, new Date())
    } catch {
      failed += 1
    }
  }
  if (failed > 0) throw new Error(`이력 기록 ${failed}건에 실패해 재시도로 넘긴다`)
}
