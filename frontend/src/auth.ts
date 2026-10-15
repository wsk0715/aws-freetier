// Cognito 로그인. 구글로 바로 보내고, 돌아온 코드를 PKCE로 ID 토큰과 바꾼다.

export const COGNITO_DOMAIN = import.meta.env.VITE_COGNITO_DOMAIN as string | undefined
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID as string | undefined
const VERIFIER_KEY = 'login-verifier'
const STATE_KEY = 'login-state'

function redirectUri(): string {
  return `${window.location.origin}/`
}

function randomString(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return base64url(bytes)
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export async function startLogin(): Promise<void> {
  const verifier = randomString()
  const state = randomString()
  sessionStorage.setItem(VERIFIER_KEY, verifier)
  sessionStorage.setItem(STATE_KEY, state)
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))

  const url = new URL('/oauth2/authorize', COGNITO_DOMAIN)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID ?? '',
    redirect_uri: redirectUri(),
    scope: 'openid email',
    identity_provider: 'Google',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  }).toString()
  window.location.assign(url)
}

// 로그인에서 돌아온 주소면 코드를 ID 토큰으로 바꾼다. 아니면 undefined.
export async function finishLogin(): Promise<string | undefined> {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const error = params.get('error')
  if (!code && !error) return undefined

  const verifier = sessionStorage.getItem(VERIFIER_KEY)
  const state = sessionStorage.getItem(STATE_KEY)
  sessionStorage.removeItem(VERIFIER_KEY)
  sessionStorage.removeItem(STATE_KEY)
  window.history.replaceState(null, '', '/')

  if (error) throw new Error(`로그인이 거절되었습니다: ${params.get('error_description') ?? error}`)
  if (!code || !verifier || params.get('state') !== state) {
    throw new Error('로그인이 완료되지 않았습니다. 다시 로그인하세요.')
  }

  const res = await fetch(new URL('/oauth2/token', COGNITO_DOMAIN), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID ?? '',
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    }),
  })
  if (!res.ok) throw new Error('로그인 토큰을 받지 못했습니다. 다시 로그인하세요.')
  return ((await res.json()) as { id_token: string }).id_token
}

export function logout(): void {
  const url = new URL('/logout', COGNITO_DOMAIN)
  url.search = new URLSearchParams({ client_id: CLIENT_ID ?? '', logout_uri: redirectUri() }).toString()
  window.location.assign(url)
}
