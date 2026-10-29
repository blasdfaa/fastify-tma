import type { FastifyInstance } from 'fastify'
import { createHmac } from 'node:crypto'
import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fastifyTMA } from '../src/index.js'

const BOT_TOKEN = '123456789:AAExampleTelegramBotToken'
const NOW = new Date('2026-10-30T00:00:00.000Z')
const AUTH_DATE = Math.floor(NOW.getTime() / 1000)
const USER = { id: 123, first_name: 'Ada', last_name: 'Lovelace' }

// Telegram HMAC calculated independently of the production SDK.
function signInitData(overrides: Record<string, string> = {}, token = BOT_TOKEN) {
  const params = new URLSearchParams({
    auth_date: String(AUTH_DATE),
    user: JSON.stringify(USER),
    ...overrides,
  })
  return signParameters(params, token)
}

function signParameters(params: URLSearchParams, token = BOT_TOKEN) {
  params.delete('hash')
  const dataCheckString = [
    ...params.entries(),
  ]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(token).digest()
  params.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'))
  return params.toString()
}

describe('fastifyTMA authentication', () => {
  const applications: FastifyInstance[] = []

  function createApp() {
    const app = Fastify()
    applications.push(app)
    return app
  }

  async function createProtectedApp(expiresIn?: number) {
    const app = createApp()
    await app.register(fastifyTMA, { botToken: BOT_TOKEN, expiresIn })
    app.get('/', { onRequest: app.tmaAuth }, async request => request.tmaInitData)
    return app
  }

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW.getTime())
  })

  afterEach(async () => {
    await Promise.all(applications.splice(0).map(app => app.close()))
    vi.restoreAllMocks()
  })

  it('provides an async route hook attaching native authenticated data', async () => {
    const app = createApp()
    await app.register(fastifyTMA, { botToken: BOT_TOKEN })
    expect(app.tmaAuth).toBeTypeOf('function')
    let authDate: unknown
    app.get('/', { onRequest: app.tmaAuth }, async (request) => {
      authDate = request.tmaInitData?.auth_date
      return request.tmaInitData
    })

    const response = await app.inject({
      url: '/',
      headers: { authorization: `tma ${signInitData({ signature: 'example-signature' })}` },
    })

    expect(response.statusCode).toBe(200)
    expect(authDate).toBeInstanceOf(Date)
    expect(authDate).toEqual(NOW)
    expect(response.json()).toMatchObject({
      auth_date: NOW.toISOString(),
      user: USER,
    })
  })

  it('rejects missing credentials with a generic challenge and server-visible cause', async () => {
    const app = createApp()
    await app.register(fastifyTMA, { botToken: BOT_TOKEN })
    let handlerReached = false
    let cause: unknown
    app.setErrorHandler((error, _, reply) => {
      cause = error instanceof Error
        ? error.cause
        : undefined
      reply.send(error)
    })
    app.get('/', { onRequest: app.tmaAuth }, async () => {
      handlerReached = true
      return 'protected'
    })

    const response = await app.inject('/')

    expect(handlerReached).toBe(false)
    expect(response.statusCode).toBe(401)
    expect(response.headers['www-authenticate']).toBe('tma')
    expect(response.json()).toEqual({
      statusCode: 401,
      code: 'FST_ERR_TMA_UNAUTHORIZED',
      error: 'Unauthorized',
      message: 'Unauthorized',
    })
    expect(cause).toBeInstanceOf(Error)
  })

  it('accepts legacy HMAC credentials without signature', async () => {
    const app = await createProtectedApp()
    const response = await app.inject({
      url: '/',
      headers: { authorization: `tma ${signInitData()}` },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ user: USER })
  })

  it.each([
    ['', 401],
    ['Bearer DATA', 401],
    ['tma', 401],
    ['tma ', 401],
    ['tma DATA extra', 401],
    ['tma DATA ', 401],
    ['tma  DATA', 401],
    ['tma\tDATA', 401],
    [' tma DATA', 401],
    ['tma DATA', 200],
    ['TMA DATA', 200],
    ['TmA DATA', 200],
  ])('accepts exactly one credential with a case-insensitive scheme: "%s"', async (header, status) => {
    const app = await createProtectedApp()
    const response = await app.inject({
      url: '/',
      headers: {
        authorization: header.replace('DATA', signInitData()),
      },
    })

    expect(response.statusCode).toBe(status)
    if (status === 401) {
      expect(response.json()).toMatchObject({ code: 'FST_ERR_TMA_UNAUTHORIZED', message: 'Unauthorized' })
      expect(response.headers['www-authenticate']).toBe('tma')
    }
  })

  it.each<{ label: string, options: unknown }>([
    { label: 'missing options', options: undefined },
    { label: 'missing token', options: {} },
    {
      label: 'empty token',
      options: { botToken: '' },
    },
    {
      label: 'whitespace token',
      options: { botToken: '   ' },
    },
    {
      label: 'numeric token',
      options: { botToken: 123 },
    },
    {
      label: 'object token',
      options: { botToken: {} },
    },
    {
      label: 'null token',
      options: { botToken: null },
    },
    ...[
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '3600',
      null,
    ].map(expiresIn => ({
      label: `invalid TTL ${expiresIn}`,
      options: { botToken: BOT_TOKEN, expiresIn },
    })),
  ])('rejects $label during registration', async ({ options }) => {
    const app = createApp()
    // @ts-expect-error JavaScript callers may pass options outside the public types.
    app.register(fastifyTMA, options)

    await expect(app.ready()).rejects.toMatchObject({ code: 'FST_ERR_TMA_INVALID_OPTIONS' })
  })

  it.each([
    '',
    ' ',
    'invalid',
    `${AUTH_DATE}.5`,
    `${AUTH_DATE}garbage`,
    '1e9',
  ])('rejects a signed noninteger auth_date "%s"', async (auth_date) => {
    const app = await createProtectedApp()
    const response = await app.inject({
      url: '/',
      headers: { authorization: `tma ${signInitData({ auth_date })}` },
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ code: 'FST_ERR_TMA_UNAUTHORIZED' })
    expect(response.headers['www-authenticate']).toBe('tma')
  })

  it.each([
    [-3599, 0, 200],
    [-3600, 0, 200],
    [-3601, 0, 401],
    [-3600, 1, 401],
    [-3600, -1, 200],
    [59, 0, 200],
    [60, 0, 200],
    [61, 0, 401],
    [60, -1, 401],
    [60, 1, 200],
  ])('enforces inclusive time boundaries (issued offset %is, clock offset %ims)', async (offset, clockShift, status) => {
    vi.mocked(Date.now).mockReturnValue(NOW.getTime() + clockShift)
    const app = await createProtectedApp()
    const response = await app.inject({
      url: '/',
      headers: { authorization: `tma ${signInitData({
        auth_date: String(AUTH_DATE + offset),
      })}` },
    })

    expect(response.statusCode).toBe(status)
    if (status === 401) {
      expect(response.json()).toMatchObject({ code: 'FST_ERR_TMA_UNAUTHORIZED' })
    }
  })

  it.each([
    [14, 0, 200],
    [15, 0, 200],
    [16, 0, 401],
    [15, 1, 401],
  ])('uses the configured TTL (age %is, clock offset %ims)', async (age, clockShift, status) => {
    vi.mocked(Date.now).mockReturnValue(NOW.getTime() + clockShift)
    const app = await createProtectedApp(15)
    const response = await app.inject({
      url: '/',
      headers: { authorization: `tma ${signInitData({
        auth_date: String(AUTH_DATE - age),
      })}` },
    })

    expect(response.statusCode).toBe(status)
  })

  it.each([
    'auth_date',
    'hash',
    'signature',
    'user',
    'unknown',
  ])('rejects duplicate %s parameters even when correctly signed', async (key) => {
    const params = new URLSearchParams({
      auth_date: String(AUTH_DATE),
      user: JSON.stringify(USER),
      signature: 'zeta',
      unknown: 'zeta',
    })
    if (key !== 'hash') {
      params.append(key, key === 'auth_date'
        ? String(AUTH_DATE - 1)
        : key === 'user'
          ? JSON.stringify(USER)
          : 'alpha')
    }
    const signed = new URLSearchParams(signParameters(params))
    if (key === 'hash') {
      signed.append('hash', signed.get('hash') ?? '')
    }
    const app = await createProtectedApp()
    const response = await app.inject({
      url: '/',
      headers: { authorization: `tma ${signed}` },
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ code: 'FST_ERR_TMA_UNAUTHORIZED' })
  })

  it.each(['Bearer invalid', 'tma invalid'])('clears trusted data before failed reauthentication with "%s"', async (authorization) => {
    const app = createApp()
    await app.register(fastifyTMA, { botToken: BOT_TOKEN })
    app.get('/', async (request, reply) => {
      await app.tmaAuth(request, reply)
      const before = request.tmaInitData
      request.headers.authorization = authorization
      await expect(app.tmaAuth(request, reply)).rejects.toMatchObject({ code: 'FST_ERR_TMA_UNAUTHORIZED' })
      return { before, after: request.tmaInitData }
    })

    const response = await app.inject({
      url: '/',
      headers: { authorization: `tma ${signInitData()}` },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().before).toMatchObject({ user: USER })
    expect(response.json().after).toBeNull()
  })

  it('rejects decoded duplicate keys even when their raw spellings differ', async () => {
    const params = new URLSearchParams({
      auth_date: String(AUTH_DATE),
    })
    params.append('auth_date', String(AUTH_DATE - 1))
    const data = signParameters(params).replace('auth_date=', '%61uth_date=')
    const app = await createProtectedApp()
    const response = await app.inject({
      url: '/',
      headers: { authorization: `tma ${data}` },
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ code: 'FST_ERR_TMA_UNAUTHORIZED' })
  })

  it('accepts a missing user but rejects malformed supplied users', async () => {
    const app = await createProtectedApp()
    const absent = signParameters(new URLSearchParams({
      auth_date: String(AUTH_DATE),
    }))
    const accepted = await app.inject({
      url: '/',
      headers: { authorization: `tma ${absent}` },
    })

    expect(accepted.statusCode).toBe(200)
    expect(accepted.json()).not.toHaveProperty('user')
    for (const user of [
      '{}',
      'null',
      '{',
      JSON.stringify({ id: '123', first_name: 'Ada' }),
    ]) {
      const rejected = await app.inject({
        url: '/',
        headers: { authorization: `tma ${signInitData({ user })}` },
      })
      expect(rejected.statusCode).toBe(401)
      expect(rejected.json()).toMatchObject({ code: 'FST_ERR_TMA_UNAUTHORIZED' })
    }
  })

  it('rejects unsigned, incorrectly signed and modified data without leaking causes', async () => {
    const app = createApp()
    await app.register(fastifyTMA, { botToken: BOT_TOKEN })
    let cause: unknown
    app.setErrorHandler((error, _, reply) => {
      cause = error instanceof Error
        ? error.cause
        : undefined
      reply.send(error)
    })
    app.get('/', { onRequest: app.tmaAuth }, async request => request.tmaInitData)
    const tampered = new URLSearchParams(signInitData())
    tampered.set('user', JSON.stringify({ id: 999, first_name: 'Mallory' }))
    const tamperedSignature = new URLSearchParams(signInitData({ signature: 'original' }))
    tamperedSignature.set('signature', 'changed')
    const missingHash = new URLSearchParams(signInitData())
    missingHash.delete('hash')
    const emptyHash = new URLSearchParams(signInitData())
    emptyHash.set('hash', '')
    const missingDate = new URLSearchParams({
      user: JSON.stringify(USER),
    })

    for (const data of [
      tampered.toString(),
      tamperedSignature.toString(),
      signInitData({}, 'another-bot-token'),
      missingHash.toString(),
      emptyHash.toString(),
      signParameters(missingDate),
    ]) {
      const response = await app.inject({
        url: '/',
        headers: { authorization: `tma ${data}` },
      })
      expect(response.statusCode).toBe(401)
      expect(response.headers['www-authenticate']).toBe('tma')
      expect(response.json()).toEqual({
        statusCode: 401,
        code: 'FST_ERR_TMA_UNAUTHORIZED',
        error: 'Unauthorized',
        message: 'Unauthorized',
      })
      expect(cause).toBeInstanceOf(Error)
      expect(response.body).not.toContain(BOT_TOKEN)
      expect(response.body).not.toContain('Mallory')
    }
  })

  it('does not authenticate public routes or read credentials from fallback transports', async () => {
    const app = createApp()
    await app.register(fastifyTMA, { botToken: BOT_TOKEN })
    app.get('/public', async request => ({ initData: request.tmaInitData }))
    app.post('/protected', { onRequest: app.tmaAuth }, async () => 'protected')
    const data = signInitData()

    const publicResponse = await app.inject({
      url: '/public',
      headers: { authorization: `tma ${data}` },
    })
    const rejected = await app.inject({
      method: 'POST',
      url: `/protected?initData=${encodeURIComponent(data)}`,
      headers: { cookie: `initData=${encodeURIComponent(data)}` },
      payload: { initData: data },
    })

    expect(publicResponse.statusCode).toBe(200)
    expect(publicResponse.json()).toEqual({ initData: null })
    expect(rejected.statusCode).toBe(401)
    expect(app.hasDecorator('tma')).toBe(false)
    expect(app.hasRequestDecorator('tmaValidate')).toBe(false)
  })

  it('protects a Fastify scope without affecting root or sibling scopes', async () => {
    const app = createApp()
    app.register(async (privateScope) => {
      await privateScope.register(fastifyTMA, { botToken: BOT_TOKEN })
      privateScope.addHook('onRequest', privateScope.tmaAuth)
      privateScope.get('/private', async request => ({ user: request.tmaInitData?.user }))
    })
    app.register(async (publicScope) => {
      publicScope.get('/sibling', async () => ({
        hasAuth: publicScope.hasDecorator('tmaAuth'),
      }))
    })
    app.get('/root', async () => ({
      hasAuth: app.hasDecorator('tmaAuth'),
    }))

    const rejected = await app.inject('/private')
    const accepted = await app.inject({
      url: '/private',
      headers: { authorization: `tma ${signInitData()}` },
    })
    const root = await app.inject('/root')
    const sibling = await app.inject('/sibling')

    expect(rejected.statusCode).toBe(401)
    expect(accepted.statusCode).toBe(200)
    expect(accepted.json()).toEqual({ user: USER })
    expect(root.statusCode).toBe(200)
    expect(root.json()).toEqual({ hasAuth: false })
    expect(sibling.statusCode).toBe(200)
    expect(sibling.json()).toEqual({ hasAuth: false })
  })

  it('isolates parsed data between concurrent requests and permits reuse until expiry', async () => {
    const app = createApp()
    await app.register(fastifyTMA, { botToken: BOT_TOKEN })
    app.get('/', { onRequest: app.tmaAuth }, async (request) => {
      const firstName = request.tmaInitData?.user?.first_name
      if (request.tmaInitData?.user) {
        request.tmaInitData.user.first_name = 'Changed in handler'
      }
      return { firstName }
    })
    const data = signInitData()
    const responses = await Promise.all([
      app.inject({
        url: '/',
        headers: { authorization: `tma ${data}` },
      }),
      app.inject({
        url: '/',
        headers: {
          authorization: `tma ${signInitData({
            user: JSON.stringify({ id: 456, first_name: 'Grace' }),
          })}`,
        },
      }),
      app.inject({
        url: '/',
        headers: { authorization: `tma ${data}` },
      }),
    ])
    expect(responses.map(response => response.statusCode)).toEqual([200, 200, 200])
    expect(responses.map(response => response.json())).toEqual([
      { firstName: 'Ada' },
      { firstName: 'Grace' },
      { firstName: 'Ada' },
    ])

    vi.mocked(Date.now).mockReturnValue(NOW.getTime() + 3600_001)
    const expired = await app.inject({
      url: '/',
      headers: { authorization: `tma ${data}` },
    })
    expect(expired.statusCode).toBe(401)
  })
})
