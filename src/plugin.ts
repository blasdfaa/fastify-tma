import type { FastifyPluginAsync } from 'fastify'
import type { FastifyTMAOptions, TMAAuthHook } from './types.js'
import { parse, validate } from '@tma.js/init-data-node'
import fp from 'fastify-plugin'
import { InvalidOptionsError, UnauthorizedError } from './errors.js'

const plugin: FastifyPluginAsync<FastifyTMAOptions> = async (fastify, options) => {
  const { botToken, expiresIn = 3600 } = options
  if (typeof botToken !== 'string' || botToken.trim().length === 0) {
    throw new InvalidOptionsError('botToken must be a nonempty string')
  }
  if (!Number.isInteger(expiresIn) || expiresIn <= 0) {
    throw new InvalidOptionsError('expiresIn must be a positive finite integer')
  }

  fastify.decorateRequest('tmaInitData', null)
  const tmaAuth: TMAAuthHook = async (request, reply) => {
    request.tmaInitData = null
    try {
      const authData = /^tma (\S+)$/i.exec(request.headers.authorization ?? '')?.[1]
      if (!authData) {
        throw new Error('Invalid authorization header')
      }
      validate(authData, botToken, { expiresIn })
      const params = new URLSearchParams(authData)
      const keys = new Set<string>()
      for (const key of params.keys()) {
        if (keys.has(key)) {
          throw new Error('Duplicate init data parameter')
        }
        keys.add(key)
      }
      const authDate = params.get('auth_date') ?? ''
      if (!/^-?\d+$/.test(authDate) || !Number.isSafeInteger(Number(authDate))) {
        throw new Error('auth_date must be an integer Unix timestamp')
      }
      const issuedAt = Number(authDate) * 1000
      const now = Date.now()
      if (issuedAt < now - expiresIn * 1000 || issuedAt > now + 60_000) {
        throw new Error('auth_date is outside the permitted time window')
      }
      // Legacy HMAC input must be verified before satisfying the parser's schema.
      if (!params.has('signature')) {
        params.set('signature', '')
      }
      request.tmaInitData = parse(params)
    }
    catch (cause) {
      reply.header('WWW-Authenticate', 'tma')
      throw new UnauthorizedError({ cause })
    }
  }
  fastify.decorate('tmaAuth', tmaAuth)
}

export const fastifyTMA = fp(plugin, {
  fastify: '5.x',
  name: 'fastify-tma',
})
