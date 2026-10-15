import { createPublicKey, verify, type JsonWebKeyInput } from 'node:crypto'

import { requiredEnv } from '../store'

type Jwk = JsonWebKeyInput['key'] & { kid: string }

// 실행 환경이 살아 있는 동안 서명 키를 재사용한다. 모르는 kid가 오면 키 교체로 보고 다시 받는다.
// ponytail: 위조 kid마다 JWKS를 다시 받는다. 호출이 많아지면 재조회 간격을 둔다.
let keys: Map<string, Jwk> | undefined

async function signingKey(kid: string): Promise<Jwk | undefined> {
  if (!keys?.has(kid)) {
    const res = await fetch(`${requiredEnv('COGNITO_ISSUER')}/.well-known/jwks.json`)
    if (!res.ok) throw new Error(`JWKS 조회 실패: ${res.status}`)
    const body = (await res.json()) as { keys: Jwk[] }
    keys = new Map(body.keys.map((key) => [key.kid, key]))
  }
  return keys.get(kid)
}

function decode(part: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

// 풀에 직접 가입한 사용자는 이메일을 마음대로 적을 수 있으므로 구글을 거친 토큰만 받는다.
function fromGoogle(identities: unknown): boolean {
  return (
    Array.isArray(identities) &&
    identities.some((i) => i && typeof i === 'object' && (i as Record<string, unknown>).providerName === 'Google')
  )
}

// Cognito ID 토큰이 이 앱에 발급되었고, 만료되지 않았고, 허용한 이메일의 것인지 확인한다.
// 형식이 틀린 토큰은 false, 서명 키를 받지 못하면 예외를 던진다.
export async function verifyIdToken(token: string, nowSeconds: number): Promise<boolean> {
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [head, body, signature] = parts as [string, string, string]

  const header = decode(head)
  if (header?.alg !== 'RS256' || typeof header.kid !== 'string') return false
  const jwk = await signingKey(header.kid)
  if (!jwk) return false

  const signed = verify(
    'sha256',
    Buffer.from(`${head}.${body}`),
    createPublicKey({ key: jwk, format: 'jwk' }),
    Buffer.from(signature, 'base64url'),
  )
  if (!signed) return false

  const claims = decode(body)
  return (
    claims !== undefined &&
    claims.iss === requiredEnv('COGNITO_ISSUER') &&
    claims.aud === requiredEnv('COGNITO_CLIENT_ID') &&
    claims.token_use === 'id' &&
    fromGoogle(claims.identities) &&
    typeof claims.exp === 'number' &&
    claims.exp > nowSeconds &&
    typeof claims.email === 'string' &&
    claims.email.toLowerCase() === requiredEnv('ALLOWED_EMAIL').toLowerCase()
  )
}
