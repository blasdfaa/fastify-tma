import process from 'node:process'
import { fastifyTMA } from 'fastify-tma'

export default async function (fastify, _opts) {
  await fastify.register(async (instance) => {
    await instance.register(fastifyTMA, {
      botToken: process.env.BOT_TOKEN,
    })

    instance.addHook('onRequest', instance.tmaAuth)

    instance.get('/tma', async (request) => {
      return request.tmaInitData
    })
  })

  fastify.get('/', async () => {
    return { hello: 'world' }
  })
}
