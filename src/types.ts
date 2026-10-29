import type { InitData } from '@tma.js/init-data-node'
import type { FastifyReply, FastifyRequest } from 'fastify'

export type TMAInitData = InitData
export type TMAAuthHook = (request: FastifyRequest, reply: FastifyReply) => Promise<void>

declare module 'fastify' {
  export interface FastifyInstance {
    tmaAuth: TMAAuthHook
  }

  export interface FastifyRequest {
    tmaInitData: TMAInitData | null
  }
}

export interface FastifyTMAOptions {
  botToken: string
  /** Maximum age of init data in seconds. @default 3600 */
  expiresIn?: number
}
