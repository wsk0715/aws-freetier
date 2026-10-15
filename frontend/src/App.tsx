import { useState } from 'react'
import type { FormEvent } from 'react'

const API_URL = import.meta.env.VITE_QUERY_API_URL as string | undefined

type InboxItem = { key: string; receivedAt: string; status: string; rawBody: string }
type Page = { items: InboxItem[]; nextCursor?: string }

const ERRORS: Record<number, string> = {
  401: '토큰이 맞지 않습니다. 배포할 때 넣은 조회 토큰을 확인하세요.',
  400: '페이지 커서가 잘못되었습니다. 처음부터 다시 불러오세요.',
}

async function fetchPage(token: string, cursor?: string): Promise<Page> {
  const url = new URL(API_URL ?? '')
  if (cursor) url.searchParams.set('cursor', cursor)
  const res = await fetch(url, { headers: { 'x-inbox-token': token } })
  if (!res.ok) throw new Error(ERRORS[res.status] ?? `조회에 실패했습니다 (HTTP ${res.status}).`)
  return (await res.json()) as Page
}

export function App() {
  const [token, setToken] = useState('')
  const [items, setItems] = useState<InboxItem[] | null>(null)
  const [cursor, setCursor] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function load(next?: string) {
    setLoading(true)
    setError('')
    try {
      const page = await fetchPage(token, next)
      setItems((prev) => (next && prev ? [...prev, ...page.items] : page.items))
      setCursor(page.nextCursor)
    } catch (e) {
      setError(e instanceof Error ? e.message : '조회에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void load()
  }

  if (!API_URL) {
    return (
      <main>
        <h1>수신함</h1>
        <p role="alert">
          조회 API 주소가 없습니다. <code>frontend/.env</code>에 <code>VITE_QUERY_API_URL</code>을 채우고 다시
          빌드하세요.
        </p>
      </main>
    )
  }

  return (
    <main>
      <h1>수신함</h1>
      <form onSubmit={onSubmit}>
        <label htmlFor="token">조회 토큰</label>
        <input
          id="token"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          required
        />
        <button type="submit" disabled={loading}>
          {items === null ? '불러오기' : '새로고침'}
        </button>
      </form>

      <p role="status" aria-live="polite">
        {loading ? '불러오는 중…' : ''}
      </p>
      {error && <p role="alert">{error}</p>}

      {items?.length === 0 && (
        <p>아직 받은 웹훅이 없습니다. 수신 주소로 서명한 요청을 보내면 여기에 나타납니다.</p>
      )}

      {items && items.length > 0 && (
        <ul className="inbox">
          {items.map((item) => (
            <li key={item.key}>
              <details>
                <summary>
                  <time dateTime={item.receivedAt}>{new Date(item.receivedAt).toLocaleString()}</time>
                  <span className={`status status-${item.status}`}>{item.status}</span>
                </summary>
                <pre>{item.rawBody}</pre>
              </details>
            </li>
          ))}
        </ul>
      )}

      {cursor && (
        <button type="button" onClick={() => void load(cursor)} disabled={loading}>
          더 보기
        </button>
      )}
    </main>
  )
}
