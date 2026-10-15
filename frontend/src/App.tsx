import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

const API_URL = import.meta.env.VITE_QUERY_API_URL as string | undefined
const TOKEN_KEY = 'inbox-token'
const AUTO_REFRESH_MS = 30_000

type InboxItem = { key: string; receivedAt: string; status: string; rawBody: string }
type Page = { items: InboxItem[]; nextCursor?: string }
type Row = InboxItem & { eventId?: string; eventType?: string; bytes: number; json?: unknown }

const STATUSES = ['완료', '수신됨', '실패', '격리', '중복'] as const
const STATUS_HINT: Record<string, string> = {
  완료: '처리와 이력 기록까지 끝난 건',
  수신됨: '저장 후 처리를 기다리는 건',
  실패: '형식 오류로 처리에 실패해 재시도 중인 건',
  격리: '자동 재처리 후에도 실패해 멈춘 건',
  중복: '같은 이벤트 id가 이미 처리된 건',
}

const ERRORS: Record<number, string> = {
  401: '토큰이 맞지 않습니다. 배포할 때 설정한 조회 토큰을 입력하세요.',
  400: '페이지 위치가 잘못되었습니다. 새로고침하세요.',
}

class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

async function fetchPage(token: string, cursor?: string): Promise<Page> {
  const url = new URL(API_URL ?? '')
  if (cursor) url.searchParams.set('cursor', cursor)
  let res: Response
  try {
    res = await fetch(url, { headers: { 'x-inbox-token': token } })
  } catch {
    throw new ApiError('조회 API에 연결하지 못했습니다. 네트워크와 API 주소를 확인하세요.')
  }
  if (!res.ok) throw new ApiError(ERRORS[res.status] ?? `조회에 실패했습니다 (HTTP ${res.status}).`, res.status)
  return (await res.json()) as Page
}

function toRow(item: InboxItem): Row {
  const bytes = new TextEncoder().encode(item.rawBody).length
  try {
    const json: unknown = JSON.parse(item.rawBody)
    if (json && typeof json === 'object' && !Array.isArray(json)) {
      const { id, type } = json as Record<string, unknown>
      return {
        ...item,
        bytes,
        json,
        eventId: typeof id === 'string' ? id : undefined,
        eventType: typeof type === 'string' ? type : undefined,
      }
    }
    return { ...item, bytes, json }
  } catch {
    return { ...item, bytes }
  }
}

const relative = new Intl.RelativeTimeFormat('ko', { numeric: 'auto' })
function ago(iso: string, now: number): string {
  const sec = Math.round((new Date(iso).getTime() - now) / 1000)
  const abs = Math.abs(sec)
  if (abs < 60) return relative.format(sec, 'second')
  if (abs < 3600) return relative.format(Math.round(sec / 60), 'minute')
  if (abs < 86400) return relative.format(Math.round(sec / 3600), 'hour')
  return relative.format(Math.round(sec / 86400), 'day')
}

const stamp = new Intl.DateTimeFormat('ko', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

function formatBytes(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`
}

function readToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

function saveToken(token: string) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token)
    else sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    // 저장소를 쓸 수 없으면 탭을 닫을 때까지만 기억한다.
  }
}

export function App() {
  const [token, setToken] = useState(readToken)
  const [rows, setRows] = useState<Row[]>([])
  const [cursor, setCursor] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [loadedAt, setLoadedAt] = useState<number>()
  const [now, setNow] = useState(() => Date.now())
  const [filter, setFilter] = useState<string>('전체')
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState<string>()
  const [auto, setAuto] = useState(false)

  const load = useCallback(
    async (next?: string) => {
      if (!token) return
      setLoading(true)
      setError('')
      try {
        const page = await fetchPage(token, next)
        const fresh = page.items.map(toRow)
        setRows((prev) => (next ? [...prev, ...fresh] : fresh))
        setCursor(page.nextCursor)
        setLoadedAt(Date.now())
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError('조회에 실패했습니다.')
        setError(err.message)
        if (err.status === 401) {
          saveToken('')
          setToken('')
        }
      } finally {
        setLoading(false)
      }
    },
    [token],
  )

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!auto || !token) return
    const id = setInterval(() => void load(), AUTO_REFRESH_MS)
    return () => clearInterval(id)
  }, [auto, token, load])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1
    return c
  }, [rows])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter(
      (r) =>
        (filter === '전체' || r.status === filter) &&
        (!q || r.rawBody.toLowerCase().includes(q) || r.key.toLowerCase().includes(q)),
    )
  }, [rows, filter, query])

  const selected = rows.find((r) => r.key === selectedKey)

  if (!API_URL) {
    return (
      <Gate>
        <h1>조회 API 주소가 없습니다</h1>
        <p>
          <code>frontend/.env</code>에 <code>VITE_QUERY_API_URL</code>을 채운 뒤 다시 빌드하세요. 값은 Terraform
          출력 <code>query_url</code>입니다.
        </p>
      </Gate>
    )
  }

  if (!token) {
    return <Connect error={error} onSubmit={(t) => (saveToken(t), setToken(t))} />
  }

  const attention = (counts['실패'] ?? 0) + (counts['격리'] ?? 0)

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span>웹훅 수신함</span>
        </div>
        <div className="sync" role="status" aria-live="polite">
          <span className={`dot ${error ? 'dot-error' : loading ? 'dot-busy' : 'dot-ok'}`} aria-hidden="true" />
          {loading ? '불러오는 중' : error ? '연결 오류' : loadedAt ? `${ago(new Date(loadedAt).toISOString(), now)} 갱신` : ''}
        </div>
        <div className="topbar-actions">
          <label className="toggle">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            30초마다 갱신
          </label>
          <button type="button" onClick={() => void load()} disabled={loading}>
            새로고침
          </button>
          <button
            type="button"
            className="quiet"
            onClick={() => {
              saveToken('')
              setToken('')
              setRows([])
            }}
          >
            연결 해제
          </button>
        </div>
      </header>

      {error && (
        <p className="banner" role="alert">
          {error}
        </p>
      )}

      <section className="overview" aria-label="상태 요약">
        <div className="headline">
          <p className="headline-number">{rows.length}</p>
          <p className="headline-label">
            불러온 수신 건{cursor ? ' (더 있음)' : ''}
            {rows[0] && (
              <>
                <br />
                마지막 수신 {ago(rows[0].receivedAt, now)}
              </>
            )}
          </p>
        </div>
        <ul className="tallies">
          {STATUSES.map((s) => (
            <li key={s}>
              <button
                type="button"
                className={`tally s-${s}`}
                aria-pressed={filter === s}
                title={STATUS_HINT[s]}
                onClick={() => setFilter(filter === s ? '전체' : s)}
              >
                <span className="tally-count">{counts[s] ?? 0}</span>
                <span className="tally-name">{s}</span>
              </button>
            </li>
          ))}
        </ul>
        {attention > 0 && (
          <p className="attention">
            확인이 필요한 건 {attention}개: 실패 {counts['실패'] ?? 0}, 격리 {counts['격리'] ?? 0}
          </p>
        )}
      </section>

      <Ribbon rows={rows} selectedKey={selectedKey} onSelect={setSelectedKey} />

      <div className="workspace">
        <section className="list" aria-label="수신 목록">
          <div className="list-tools">
            <div className="segmented" role="group" aria-label="상태 필터">
              {['전체', ...STATUSES].map((s) => (
                <button key={s} type="button" aria-pressed={filter === s} onClick={() => setFilter(s)}>
                  {s}
                </button>
              ))}
            </div>
            <input
              type="search"
              className="search"
              placeholder="이벤트 id, 타입, 본문 검색"
              aria-label="수신 항목 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {rows.length === 0 && !loading ? (
            <div className="empty">
              <p className="empty-title">아직 받은 웹훅이 없습니다</p>
              <p>수신 주소로 서명한 요청을 보내면 여기에 나타납니다. 받은 뒤 새로고침하세요.</p>
            </div>
          ) : visible.length === 0 ? (
            <div className="empty">
              <p className="empty-title">조건에 맞는 건이 없습니다</p>
              <p>필터나 검색어를 바꾸거나, 아래에서 이전 기록을 더 불러오세요.</p>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col">수신 시각</th>
                  <th scope="col">상태</th>
                  <th scope="col">이벤트 타입</th>
                  <th scope="col" className="col-id">
                    이벤트 id
                  </th>
                  <th scope="col" className="col-size">
                    크기
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr
                    key={r.key}
                    tabIndex={0}
                    aria-selected={r.key === selectedKey}
                    onClick={() => setSelectedKey(r.key)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setSelectedKey(r.key)
                      }
                    }}
                  >
                    <td>
                      <time dateTime={r.receivedAt} title={stamp.format(new Date(r.receivedAt))}>
                        {stamp.format(new Date(r.receivedAt))}
                      </time>
                      <span className="sub">{ago(r.receivedAt, now)}</span>
                    </td>
                    <td>
                      <Status value={r.status} />
                    </td>
                    <td className="type">{r.eventType ?? <span className="sub">형식 없음</span>}</td>
                    <td className="col-id code">{r.eventId ?? '—'}</td>
                    <td className="col-size num">{formatBytes(r.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {cursor && (
            <button type="button" className="more" onClick={() => void load(cursor)} disabled={loading}>
              이전 기록 20건 더 불러오기
            </button>
          )}
        </section>

        <Detail row={selected} now={now} onClose={() => setSelectedKey(undefined)} />
      </div>
    </div>
  )
}

function Status({ value }: { value: string }) {
  return (
    <span className={`status s-${value}`} title={STATUS_HINT[value]}>
      {value}
    </span>
  )
}

function Ribbon({
  rows,
  selectedKey,
  onSelect,
}: {
  rows: Row[]
  selectedKey?: string
  onSelect: (key: string) => void
}) {
  if (rows.length === 0) return null
  const times = rows.map((r) => new Date(r.receivedAt).getTime())
  const min = Math.min(...times)
  const max = Math.max(...times)
  const span = Math.max(max - min, 1)
  return (
    <section className="ribbon" aria-label="수신 시각 분포">
      <div className="ribbon-track">
        {rows.map((r, i) => (
          <button
            key={r.key}
            type="button"
            className={`tick s-${r.status}`}
            style={{ left: `${(((times[i] ?? min) - min) / span) * 100}%` }}
            aria-label={`${stamp.format(new Date(r.receivedAt))} ${r.status}`}
            aria-pressed={r.key === selectedKey}
            tabIndex={-1}
            onClick={() => onSelect(r.key)}
          />
        ))}
      </div>
      <div className="ribbon-axis">
        <time dateTime={new Date(min).toISOString()}>{stamp.format(min)}</time>
        <time dateTime={new Date(max).toISOString()}>{stamp.format(max)}</time>
      </div>
    </section>
  )
}

function Detail({ row, now, onClose }: { row?: Row; now: number; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => setCopied(false), [row?.key])

  if (!row) {
    return (
      <aside className="detail detail-empty" aria-label="상세">
        <p>목록에서 한 건을 고르면 원문과 처리 상태를 여기서 봅니다.</p>
      </aside>
    )
  }

  const pretty = row.json === undefined ? row.rawBody : JSON.stringify(row.json, null, 2)
  return (
    <aside className="detail" aria-label="상세">
      <div className="detail-head">
        <h2>{row.eventType ?? '형식을 읽을 수 없는 본문'}</h2>
        <button type="button" className="quiet" onClick={onClose} aria-label="상세 닫기">
          닫기
        </button>
      </div>
      <dl>
        <dt>상태</dt>
        <dd>
          <Status value={row.status} />
          <span className="hint">{STATUS_HINT[row.status]}</span>
        </dd>
        <dt>수신 시각</dt>
        <dd>
          {new Date(row.receivedAt).toLocaleString('ko')} ({ago(row.receivedAt, now)})
        </dd>
        <dt>이벤트 id</dt>
        <dd className="code">{row.eventId ?? '없음'}</dd>
        <dt>수신 키</dt>
        <dd className="code">{row.key}</dd>
        <dt>크기</dt>
        <dd>{formatBytes(row.bytes)}</dd>
      </dl>
      <div className="payload-head">
        <h3>원문</h3>
        <button
          type="button"
          className="quiet"
          onClick={() =>
            void navigator.clipboard.writeText(row.rawBody).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
        >
          {copied ? '복사됨' : '원문 복사'}
        </button>
      </div>
      {row.json === undefined && <p className="hint">JSON으로 읽을 수 없어 받은 그대로 보여줍니다.</p>}
      <pre className="payload">{pretty}</pre>
    </aside>
  )
}

function Connect({ error, onSubmit }: { error: string; onSubmit: (token: string) => void }) {
  const [value, setValue] = useState('')
  function submit(e: FormEvent) {
    e.preventDefault()
    if (value.trim()) onSubmit(value.trim())
  }
  return (
    <Gate>
      <h1>웹훅 수신함</h1>
      <p>받은 웹훅과 처리 상태를 봅니다. 조회 토큰을 입력해 연결하세요.</p>
      <form onSubmit={submit} className="connect">
        <label htmlFor="token">조회 토큰</label>
        <input
          id="token"
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
        />
        <button type="submit">연결</button>
      </form>
      {error && (
        <p className="banner" role="alert">
          {error}
        </p>
      )}
      <p className="hint">토큰은 이 탭을 닫을 때까지만 기억합니다.</p>
    </Gate>
  )
}

function Gate({ children }: { children: ReactNode }) {
  return (
    <main className="gate">
      <div className="gate-panel">{children}</div>
    </main>
  )
}
