import type { FastifyInstance, FastifyReply, FastifyRequest, onRequestAsyncHookHandler } from 'fastify'
import type { FastifyTMAOptions, TMAAuthHook, TMAInitData } from '../src/index.js'
import { expectTypeOf } from 'vitest'

function publicTypes(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply) {
  expectTypeOf(app.tmaAuth).toEqualTypeOf<TMAAuthHook>()
  expectTypeOf(app.tmaAuth).toExtend<onRequestAsyncHookHandler>()
  expectTypeOf(app.tmaAuth(request, reply)).toEqualTypeOf<Promise<void>>()
  expectTypeOf(request.tmaInitData).toEqualTypeOf<TMAInitData | null>()
  expectTypeOf(request.tmaInitData?.auth_date).toEqualTypeOf<Date | undefined>()
  expectTypeOf(request.tmaInitData?.user?.first_name).toEqualTypeOf<string | undefined>()
  expectTypeOf(request.tmaInitData?.user?.id).toEqualTypeOf<number | undefined>()

  // @ts-expect-error The old request validator is not part of the public API.
  request.tmaValidate()
  // @ts-expect-error The low-level server validator has been removed.
  app.tma.validate('data', 'token')
}

const options: FastifyTMAOptions = { botToken: 'token', expiresIn: 15 }
const optionalUser: TMAInitData = {
  auth_date: new Date(),
  hash: 'hash',
  signature: '',
}
// @ts-expect-error botToken is required.
const missingToken: FastifyTMAOptions = {}
// @ts-expect-error botToken must be a string.
const numericToken: FastifyTMAOptions = { botToken: 123 }
// @ts-expect-error expiresIn must be a number.
const stringTTL: FastifyTMAOptions = { botToken: 'token', expiresIn: '15' }
// @ts-expect-error The request decorator name is fixed.
const customDecorator: FastifyTMAOptions = { botToken: 'token', decoratorName: 'custom' }
// @ts-expect-error Native auth_date is a Date rather than a Unix-seconds number.
const numericDate: TMAInitData['auth_date'] = 123
// @ts-expect-error Native first_name is a string.
const invalidName: NonNullable<TMAInitData['user']>['first_name'] = 123

void publicTypes
void options
void optionalUser
void missingToken
void numericToken
void stringTTL
void customDecorator
void numericDate
void invalidName
