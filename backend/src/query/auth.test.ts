import { generateKeyPairSync, sign } from 'node:crypto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { verifyIdToken } from './auth'

const ISSUER = 'https://cognito-idp.ap-northeast-2.amazonaws.com/pool'
const CLIENT = 'client-1'
const EMAIL = 'owner@example.com'
const NOW = 1_800_000_000

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const other = generateKeyPairSync('rsa', { modulusLength: 2048 })
const JWKS = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }] }

const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')

function token(
  claims: Record<string, unknown> = {},
  opts: { kid?: string; alg?: string; key?: typeof privateKey } = {},
) {
  const head = part({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? 'k1' })
  const body = part({ iss: ISSUER, aud: CLIENT, token_use: 'id', exp: NOW + 60, email: EMAIL, ...claims })
  const signature = sign('sha256', Buffer.from(`${head}.${body}`), opts.key ?? privateKey).toString('base64url')
  return `${head}.${body}.${signature}`
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubEnv('COGNITO_ISSUER', ISSUER)
  vi.stubEnv('COGNITO_CLIENT_ID', CLIENT)
  vi.stubEnv('ALLOWED_EMAIL', EMAIL)
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => JWKS })
  vi.stubGlobal('fetch', fetchMock)
})

describe('ID 토큰 검증', () => {
  it('허용한 이메일의 유효한 토큰을 받아들인다', async () => {
    expect(await verifyIdToken(token(), NOW)).toBe(true)
  })

  it('이메일 대소문자는 구분하지 않는다', async () => {
    expect(await verifyIdToken(token({ email: 'Owner@Example.com' }), NOW)).toBe(true)
  })

  it.each([
    ['다른 이메일', { email: 'someone@example.com' }],
    ['만료', { exp: NOW }],
    ['다른 앱', { aud: 'client-2' }],
    ['다른 발급자', { iss: 'https://evil.example.com' }],
    ['액세스 토큰', { token_use: 'access' }],
  ])('%s이면 거절한다', async (_, claims) => {
    expect(await verifyIdToken(token(claims), NOW)).toBe(false)
  })

  it('다른 키로 서명했으면 거절한다', async () => {
    expect(await verifyIdToken(token({}, { key: other.privateKey }), NOW)).toBe(false)
  })

  it('RS256이 아니면 키를 찾지 않고 거절한다', async () => {
    expect(await verifyIdToken(token({}, { alg: 'none', kid: 'k-none' }), NOW)).toBe(false)
  })

  it('모르는 kid는 거절한다', async () => {
    expect(await verifyIdToken(token({}, { kid: 'k9' }), NOW)).toBe(false)
  })

  it('형식이 깨진 토큰은 거절한다', async () => {
    expect(await verifyIdToken('a.b', NOW)).toBe(false)
    expect(await verifyIdToken('!!.!!.!!', NOW)).toBe(false)
  })

  it('서명 키를 받지 못하면 예외를 던진다', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 })
    await expect(verifyIdToken(token({}, { kid: 'k-new' }), NOW)).rejects.toThrow()
  })
})
