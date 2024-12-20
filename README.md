# fastify-tma

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]
[![License][license-src]][license-href]
[![JSDocs][jsdocs-src]][jsdocs-href]

Fastify plugin for [Telegram Mini Apps](https://docs.telegram-mini-apps.com/) integration. Provides secure auth validation, type-safe decorators, and utilities for building Telegram Mini Apps backend with Fastify.

## Install

```bash
# npm
npm install fastify-tma

# pnpm
pnpm install fastify-tma
```

## Usage

Import `fastify-tma` and register.

```js
import Fastify from 'fastify'
import { fastifyTMA } from 'fastify-tma'

const fastify = Fastify()

fastify.register(fastifyTMA, {
  botToken: 'your-tg-bot-token'
})

fastify.addHook('onRequest', req => req.tmaValidate())

fastify.listen({ port: 3000 })
```

Afterwards, just use `request.tmaInitData` in order to retrieve telegram user information:

```ts
fastify.get('/', async (request, reply) => {
  return request.tmaInitData
})
```

However, in most cases we only want to check some routes in our application. To achieve this goal, you can transfer the verification logic to such a plugin, for example:

```ts
import fp from 'fastify-plugin'
import { fastifyTMA } from 'fastify-tma'

export default fp(async (fastify, opts) => {
  await fastify.register(fastifyTMA, {
    botToken: 'your-tg-bot-token'
  })

  fastify.decorate('tgValidate', async (req, reply) => {
    try {
      await req.tmaValidate()
    }
    catch (err) {
      reply.send(err)
    }
  })
})
```

Then use the `onRequest` of a route to protect it and access the telegram user information inside:

```ts
export default async function (fastify, opts) {
  fastify.get(
    '/',
    {
      onRequest: [fastify.tgValidate]
    },
    async (req, reply) => {
      return req.tmaInitData
    }
  )
}
```

Make sure that you also check [@fastify/auth](https://github.com/fastify/fastify-auth) plugin for composing more complex strategies.

[npm-version-src]: https://img.shields.io/npm/v/fastify-tma?style=flat&colorA=18181B&colorB=3e63dd
[npm-version-href]: https://npmjs.com/package/fastify-tma
[npm-downloads-src]: https://img.shields.io/npm/dm/fastify-tma?style=flat&colorA=18181B&colorB=3e63dd
[npm-downloads-href]: https://npmjs.com/package/fastify-tma
[bundle-src]: https://img.shields.io/bundlephobia/minzip/fastify-tma?style=flat&colorA=18181B&colorB=3e63dd
[bundle-href]: https://bundlephobia.com/result?p=fastify-tma
[license-src]: https://img.shields.io/github/license/blasdfaa/fastify-tma.svg?style=flat&colorA=18181B&colorB=3e63dd
[license-href]: https://github.com/blasdfaa/fastify-tma/blob/main/LICENSE
[jsdocs-src]: https://img.shields.io/badge/jsDocs.io-reference-18181B?style=flat&colorA=18181B&colorB=3e63dd
[jsdocs-href]: https://www.jsdocs.io/package/fastify-tma
