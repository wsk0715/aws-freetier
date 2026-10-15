import {
  deleteDeadLetter,
  listReceiptStatuses,
  putSummary,
  receiveDeadLetters,
  sendWorkBody,
  setReceiptStatus,
} from '../store'

// 한 번 실행에서 꺼내는 DLQ 메시지 상한. 함수 타임아웃 안에 끝나게 묶는다.
const MAX_DEAD_LETTERS = 100

type WorkMessage = { receiptKey: string; redrives: number }

function parseWork(body: string): WorkMessage | undefined {
  try {
    const parsed: unknown = JSON.parse(body)
    if (parsed === null || typeof parsed !== 'object') return undefined
    const { receiptKey, redrives } = parsed as Record<string, unknown>
    if (typeof receiptKey !== 'string' || receiptKey.length === 0) return undefined
    return { receiptKey, redrives: typeof redrives === 'number' ? redrives : 0 }
  } catch {
    return undefined
  }
}

async function redriveDeadLetters(): Promise<{ redriven: number; quarantined: number }> {
  let redriven = 0
  let quarantined = 0
  let taken = 0
  while (taken < MAX_DEAD_LETTERS) {
    const letters = await receiveDeadLetters()
    if (letters.length === 0) break
    for (const letter of letters) {
      taken += 1
      const work = parseWork(letter.body)
      if (work && work.redrives < 1) {
        // 재처리는 한 번만 한다. 다시 실패해 돌아오면 격리한다.
        await sendWorkBody(JSON.stringify({ receiptKey: work.receiptKey, redrives: 1 }))
        redriven += 1
      } else {
        if (work) await setReceiptStatus(work.receiptKey, '격리')
        quarantined += 1
      }
      await deleteDeadLetter(letter.receiptHandle)
    }
  }
  return { redriven, quarantined }
}

export function previousDay(now: Date): string {
  return new Date(now.getTime() - 86400_000).toISOString().slice(0, 10)
}

export const handler = async (): Promise<void> => {
  const now = new Date()
  const { redriven, quarantined } = await redriveDeadLetters()

  const day = previousDay(now)
  const counts: Record<string, number> = {}
  for (const status of await listReceiptStatuses(day)) counts[status] = (counts[status] ?? 0) + 1
  await putSummary(day, counts, redriven, quarantined, now)

  console.log(JSON.stringify({ day, counts, redriven, quarantined }))
}
