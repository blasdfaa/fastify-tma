# fastify-tma

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]
[![License][license-src]][license-href]
[![JSDocs][jsdocs-src]][jsdocs-href]

Authenticate [Telegram Mini Apps](https://docs.telegram-mini-apps.com/) requests with a ready-to-use Fastify hook and typed init data.

## Install

Requires **Fastify 5** and a supported **Node.js 22, 24, or 26** runtime. The package is **ESM-only**; use `import` from an ESM application.

```bash
npm install fastify fastify-tma
# or
pnpm add fastify fastify-tma
```

## Usage

Register the plugin with your bot token, then pass `fastify.tmaAuth` directly as the hook for protected routes:

```js
import Fastify from 'fastify'
import { fastifyTMA } from 'fastify-tma'

const fastify = Fastify()

await fastify.register(fastifyTMA, {
  botToken: process.env.BOT_TOKEN,
  expiresIn: 3600
})

fastify.get('/public', async () => ({ public: true }))

fastify.get('/me', {
  onRequest: fastify.tmaAuth
}, async (request) => {
  return request.tmaInitData
})

await fastify.listen({ port: 3000 })
```

Set `BOT_TOKEN` before starting the application. `expiresIn` is optional and defaults to 3600 seconds. Plugin registration alone leaves routes public; `tmaAuth` is already asynchronous and needs no wrapper.

Send the original `Telegram.WebApp.initData` string from the Mini App:

```js
await fetch('/me', {
  headers: {
    Authorization: `tma ${window.Telegram.WebApp.initData}`
  }
})
```

Only the `Authorization` header is accepted. The `tma` scheme is case-insensitive; empty credentials, extra credentials, and other schemes are rejected. Cookies, query parameters, and request bodies do not provide fallback credentials. Do not use `initDataUnsafe` as proof of authentication.

### Protect a scope

After registering the plugin, use the same hook in a child scope:

```js
await fastify.register(async (privateRoutes) => {
  privateRoutes.addHook('onRequest', privateRoutes.tmaAuth)

  privateRoutes.get('/private', async (request) => {
    return request.tmaInitData
  })
})
```

Fastify's normal encapsulation rules apply: the hook protects routes in that scope and its children. Register it before the routes it should protect; root and sibling routes remain unaffected.

## Options

| Option | Description |
| --- | --- |
| `botToken` | Required nonempty string containing your Telegram bot token. |
| `expiresIn` | Optional positive integer number of seconds; defaults to `3600`. |

Invalid options fail plugin registration. A TTL of `0` does not disable expiration: zero, negative or fractional values, `NaN`, `Infinity`, and values of another type are rejected.

## Authenticated data

`request.tmaInitData` uses the native types and snake_case names from [@tma.js/init-data-node](https://www.npmjs.com/package/@tma.js/init-data-node): `auth_date`, `query_id`, `user.first_name`, and the other SDK fields. Inside a handler, `auth_date` is a `Date`; JSON serialization represents it as an ISO string.

The `user` field is optional. Correctly authenticated init data without a user is accepted; an invalid supplied user object is rejected. If a route requires a user identity, check `request.tmaInitData?.user` and apply your application's authorization policy before using `user.id`.

In the plugin's scope, the data field starts as `null`. Each successful hook invocation attaches parsed data belonging to that request. Every invocation clears the field first, so catching a failed revalidation does not leave old trusted data attached. Concurrent requests do not share parsed objects.

## Validation and errors

The hook verifies the HMAC with your bot token against the original init-data string, then parses the authenticated data. It also enforces these rules:

- `auth_date` must be an integer Unix timestamp in seconds. Empty, fractional, nonnumeric, or partially parsed timestamps are rejected.
- Data exactly `expiresIn` seconds old is accepted; older data is rejected. With the default TTL, exactly 3600 seconds old is valid.
- A timestamp up to **60 seconds ahead** of server time is accepted, including exactly 60 seconds. A larger future offset is rejected.
- Duplicate query keys are rejected, including unknown keys and repeated `hash`, `auth_date`, or `signature` fields.
- Legacy data without `signature` is accepted when its HMAC is valid. The missing field is normalized for parsing only after the original data has been verified; this is HMAC authentication, not Ed25519 verification.

All expected authentication failures return HTTP **401**, code **`FST_ERR_TMA_UNAUTHORIZED`**, a generic message, and **`WWW-Authenticate: tma`**. The original failure is available through `error.cause` to an application's error handler; it is not included in the client response. Configuration errors fail registration instead of returning 401.

Authentication is stateless. The same valid init-data string can be used repeatedly within its time window; the plugin does not create sessions or track consumed signatures to prevent replay.

See the [migration guide](./docs/migration.md) for the breaking changes from the previous API. For low-level signing, parsing, or validation outside the hook, use the SDK directly.

## Development

Use **Node.js 24.15+ or Node.js 26** for the current development tools and the pnpm version pinned in [package.json](./package.json). This tooling requirement is separate from the package's Node.js 22/24/26 runtime support.

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test:coverage
```

| Command | Purpose |
| --- | --- |
| `pnpm lint` | Check code and documentation conventions. |
| `pnpm test` | Run HTTP behavior tests and public type checks. |
| `pnpm test:unit` | Run the Fastify integration tests with real HMAC signatures. |
| `pnpm test:types` | Check the public TypeScript contract. |
| `pnpm build` | Compile production TypeScript to ESM JavaScript and declarations. |
| `pnpm test:package` | Verify a packed package installed in a separate ESM consumer. |
| `pnpm test:coverage` | Report behavioral test coverage. |
| `pnpm check` | Run lint, tests, build, and installed packed-package checks. |

The build uses plain `tsc` with NodeNext resolution and emits `.js` and `.d.ts` files. The root package exports the compiled artifacts; `prepack` builds fresh output before packaging. There is no CommonJS or SmartBundle build. Packaging locally does not publish a release:

```bash
pnpm pack
```

The playground uses the local package through `workspace:*` and its compiled exports. Set `BOT_TOKEN` in your environment, then build before starting it:

```bash
pnpm build
pnpm --dir playground dev
```

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
