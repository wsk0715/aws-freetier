import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { COGNITO_DOMAIN, finishLogin, logout, startLogin } from './auth'

const API_URL = import.meta.env.VITE_QUERY_API_URL as string | undefined
const TOKEN_KEY = 'inbox-id-token'
const AUTO_REFRESH_MS = 30_000

type InboxItem = {
  key: string
  receivedAt: string
  status: string
  rawBody: string
  failureReason?: string
  requeueCount?: number
  requeuedAt?: string
}
type DailySummary = {
  day: string
  counts: Record<string, number>
  redriven: number
  quarantined: number
  summarizedAt: string
}
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

const FAILURE_REASON: Record<string, string> = {
  invalid_json: '본문이 JSON이 아닙니다',
  not_an_object: '본문이 JSON 객체가 아닙니다',
  invalid_id: 'id가 없거나 빈 문자열입니다',
  invalid_type: 'type이 없거나 빈 문자열입니다',
  missing_data: 'data 필드가 없습니다',
}

const ERRORS: Record<number, string> = {
  401: '로그인이 만료되었거나 허용되지 않은 계정입니다. 다시 로그인하세요.',
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

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const url = new URL(path, API_URL)
  let res: Response
  try {
    res = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, ...init.headers } })
  } catch {
    throw new ApiError('조회 API에 연결하지 못했습니다. 네트워크와 API 주소를 확인하세요.')
  }
  if (!res.ok) throw new ApiError(ERRORS[res.status] ?? `요청에 실패했습니다 (HTTP ${res.status}).`, res.status)
  return (await res.json()) as T
}

function fetchPage(token: string, cursor?: string): Promise<Page> {
  return call<Page>(token, cursor ? `./?cursor=${encodeURIComponent(cursor)}` : './')
}

async function fetchSummaries(token: string): Promise<DailySummary[]> {
  return (await call<{ summaries: DailySummary[] }>(token, 'summaries')).summaries
}

async function requestReprocess(token: string, key: string): Promise<void> {
  try {
    await call(token, 'reprocess', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key }),
    })
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      throw new ApiError('이미 격리 상태가 아닙니다. 새로고침해 현재 상태를 확인하세요.', 409)
    }
    throw e
  }
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
  const [summaries, setSummaries] = useState<DailySummary[]>([])
  const [signingIn, setSigningIn] = useState(() => /[?&](code|error)=/.test(window.location.search))

  useEffect(() => {
    if (!signingIn) return
    finishLogin()
      .then((t) => {
        if (!t) return
        saveToken(t)
        setToken(t)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : '로그인에 실패했습니다.'))
      .finally(() => setSigningIn(false))
  }, [signingIn])

  const load = useCallback(
    async (next?: string) => {
      if (!token) return
      setLoading(true)
      setError('')
      try {
        const [page, days] = await Promise.all([
          fetchPage(token, next),
          next ? undefined : fetchSummaries(token),
        ])
        const fresh = page.items.map(toRow)
        setRows((prev) => (next ? [...prev, ...fresh] : fresh))
        setCursor(page.nextCursor)
        if (days) setSummaries(days)
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

  if (!API_URL || !COGNITO_DOMAIN) {
    return (
      <Gate>
        <h1>조회 API 또는 로그인 설정이 없습니다</h1>
        <p>
          <code>frontend/.env</code>에 <code>VITE_QUERY_API_URL</code>, <code>VITE_COGNITO_DOMAIN</code>,{' '}
          <code>VITE_COGNITO_CLIENT_ID</code>를 채운 뒤 다시 빌드하세요. 값은 Terraform 출력 <code>query_url</code>,{' '}
          <code>cognito_domain</code>, <code>cognito_client_id</code>입니다.
        </p>
      </Gate>
    )
  }

  if (signingIn) {
    return (
      <Gate>
        <p>로그인하는 중입니다.</p>
      </Gate>
    )
  }

  if (!token) {
    return <Connect error={error} />
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
              logout()
            }}
          >
            로그아웃
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

        <Detail
          row={selected}
          now={now}
          onClose={() => setSelectedKey(undefined)}
          onReprocess={async (key) => {
            await requestReprocess(token, key)
            setRows((prev) =>
              prev.map((r) =>
                r.key === key
                  ? { ...r, status: '수신됨', requeueCount: (r.requeueCount ?? 0) + 1, requeuedAt: new Date().toISOString() }
                  : r,
              ),
            )
            // 워커가 처리할 시간을 두고 결과를 다시 읽는다.
            setTimeout(() => void load(), 5000)
          }}
        />
      </div>

      <Summaries summaries={summaries} />
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

function Detail({
  row,
  now,
  onClose,
  onReprocess,
}: {
  row?: Row
  now: number
  onClose: () => void
  onReprocess: (key: string) => Promise<void>
}) {
  const [copied, setCopied] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    setCopied(false)
    setConfirming(false)
    setNotice('')
  }, [row?.key])

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
        {row.failureReason && (row.status === '실패' || row.status === '격리') && (
          <>
            <dt>실패 사유</dt>
            <dd>
              {FAILURE_REASON[row.failureReason] ?? row.failureReason}
              <span className="hint code">{row.failureReason}</span>
            </dd>
          </>
        )}
        {row.requeueCount !== undefined && (
          <>
            <dt>수동 재처리</dt>
            <dd>
              {row.requeueCount}회
              {row.requeuedAt && <span className="hint">마지막 {ago(row.requeuedAt, now)}</span>}
            </dd>
          </>
        )}
        <dt>크기</dt>
        <dd>{formatBytes(row.bytes)}</dd>
      </dl>
      {row.status === '격리' && (
        <div className="reprocess">
          {!confirming ? (
            <button type="button" onClick={() => setConfirming(true)}>
              다시 처리
            </button>
          ) : (
            <div className="confirm" role="group" aria-label="다시 처리 확인">
              <p>
                이 건을 작업 큐에 한 번 더 넣습니다. 처리에 실패하면 자동 재처리 없이 다시 격리됩니다.
                {row.failureReason && ' 형식 오류는 원문이 같으므로 다시 실패합니다.'}
              </p>
              <div className="confirm-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true)
                    setNotice('')
                    onReprocess(row.key)
                      .then(() => setNotice('작업 큐에 다시 넣었습니다. 몇 초 뒤 결과가 반영됩니다.'))
                      .catch((e: unknown) => setNotice(e instanceof Error ? e.message : '다시 처리하지 못했습니다.'))
                      .finally(() => {
                        setBusy(false)
                        setConfirming(false)
                      })
                  }}
                >
                  {busy ? '넣는 중…' : '다시 처리 확정'}
                </button>
                <button type="button" className="quiet" onClick={() => setConfirming(false)} disabled={busy}>
                  취소
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
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

function Summaries({ summaries }: { summaries: DailySummary[] }) {
  if (summaries.length === 0) return null
  return (
    <section className="summaries" aria-labelledby="summaries-title">
      <h2 id="summaries-title">일일 요약</h2>
      <p className="hint">매일 09:07(KST)에 운영 작업이 전날 수신 건을 상태별로 셉니다.</p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">날짜 (UTC)</th>
              <th scope="col" className="num">
                수신
              </th>
              {STATUSES.map((s) => (
                <th key={s} scope="col" className="num">
                  {s}
                </th>
              ))}
              <th scope="col" className="num">
                자동 재처리
              </th>
              <th scope="col" className="num">
                새로 격리
              </th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((d) => (
              <tr key={d.day}>
                <td>{d.day}</td>
                <td className="num">{Object.values(d.counts).reduce((a, b) => a + b, 0)}</td>
                {STATUSES.map((s) => (
                  <td key={s} className={`num ${d.counts[s] ? `s-${s} strong` : 'sub'}`}>
                    {d.counts[s] ?? 0}
                  </td>
                ))}
                <td className="num">{d.redriven}</td>
                <td className="num">{d.quarantined}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Connect({ error }: { error: string }) {
  return (
    <Gate>
      <h1>웹훅 수신함</h1>
      <p>받은 웹훅과 처리 상태를 봅니다. 허용된 구글 계정으로 로그인하세요.</p>
      <button type="button" className="google" onClick={() => void startLogin()}>
        <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
        Google 계정으로 로그인
      </button>
      {error && (
        <p className="banner" role="alert">
          {error}
        </p>
      )}
      <p className="hint">로그인은 이 탭을 닫거나 한 시간이 지나면 풀립니다.</p>
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
