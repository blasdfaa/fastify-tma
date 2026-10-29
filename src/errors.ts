import createError from '@fastify/error'

export const InvalidOptionsError = createError(
  'FST_ERR_TMA_INVALID_OPTIONS',
  'Invalid fastify-tma options: %s',
)
export const UnauthorizedError = createError(
  'FST_ERR_TMA_UNAUTHORIZED',
  'Unauthorized',
  401,
)
