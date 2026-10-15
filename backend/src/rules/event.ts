export type NormalizedEvent = {
  id: string
  type: string
  data: unknown
}

export type EventRejection = 'invalid_json' | 'not_an_object' | 'invalid_id' | 'invalid_type' | 'missing_data'

export type ParseResult = { ok: true; event: NormalizedEvent } | { ok: false; reason: EventRejection }

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

export function parseEvent(raw: string): ParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'invalid_json' }
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'not_an_object' }
  }

  const candidate = parsed as Record<string, unknown>
  if (!isNonEmptyString(candidate.id)) return { ok: false, reason: 'invalid_id' }
  if (!isNonEmptyString(candidate.type)) return { ok: false, reason: 'invalid_type' }
  if (!('data' in candidate)) return { ok: false, reason: 'missing_data' }

  return { ok: true, event: { id: candidate.id, type: candidate.type, data: candidate.data } }
}
