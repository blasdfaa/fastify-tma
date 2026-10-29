# Migration to the hook-based API

This migration introduces breaking changes. No release version is assigned by this guide; use the release notes to identify the published version containing this API.

## Replace the authentication hook

Register the plugin once in the required Fastify context, then use its ready-made async hook directly:

```js
import Fastify from 'fastify'
import { fastifyTMA } from 'fastify-tma'

const fastify = Fastify()

await fastify.register(fastifyTMA, {
  botToken: process.env.BOT_TOKEN,
  expiresIn: 3600
})

fastify.get('/me', {
  onRequest: fastify.tmaAuth
}, async (request) => {
  return request.tmaInitData
})
```

Set the bot token before registering. Plugin registration alone does not protect routes. Use `addHook('onRequest', fastify.tmaAuth)` before defining routes to protect a Fastify scope; root and sibling routes outside that scope remain unaffected.

| Previous interface | Replacement |
| --- | --- |
| `request.tmaValidate()` in an application-written wrapper | `fastify.tmaAuth` as the route or scope hook. |
| `fastify.tma.validate` | Removed. Use [@tma.js/init-data-node](https://www.npmjs.com/package/@tma.js/init-data-node) directly for low-level validation or other SDK helpers. |
| `decoratorName` | Removed. Parsed data is always attached to `request.tmaInitData`. |
| camelCase fields such as `authDate`, `queryId`, `user.firstName` | Native SDK fields: `auth_date`, `query_id`, `user.first_name`. |
| `FST_ERR_TMA_INVALID_AUTH_TYPE` and `FST_ERR_TMA_INVALID_AUTH_DATA` | HTTP 401 with `FST_ERR_TMA_UNAUTHORIZED`. |
| CommonJS `require` | ESM `import`. |

Remove obsolete wrappers and custom Fastify declarations for renamed data properties. The package supplies its public Fastify types. The hook is asynchronous; do not replace it with a synchronous callback that never calls Fastify's `done` callback.

## Update data and option handling

`auth_date` remains a `Date` in application handlers. Its JSON representation is an ISO string. Nested names also use snake_case; update field access rather than renaming the SDK output back to camelCase.

`user` is optional. Valid init data without a user passes authentication; your application decides whether a route requires `user.id`. A supplied but malformed user, including an empty object, is rejected.

The required `botToken` must be a nonempty string. The optional `expiresIn` is a positive integer number of seconds with default `3600`. Invalid options fail registration. Unlike the low-level SDK option, `expiresIn: 0` cannot disable expiry; negative, fractional, nonfinite, or incorrectly typed values are also invalid.

## Account for the stricter request boundary

- Send only the original init-data string as `Authorization: tma <rawInitData>`. Scheme casing is ignored. Missing or extra credentials and other schemes are rejected; cookies, query parameters, and bodies are not fallback sources.
- Use an integer Unix timestamp for `auth_date`. Empty, fractional, nonnumeric, or numeric-prefix-with-garbage values are rejected.
- Data exactly as old as the configured TTL is accepted; older data is rejected. Future creation times are allowed up to 60 seconds inclusive, but not beyond.
- Duplicate query keys are rejected even when the key is unknown to the SDK and the HMAC is correct.
- Correctly HMAC-signed legacy data without `signature` still passes. Only after verifying the original string does the hook add an absent `signature` to a copy for parsing. A supplied field remains part of the original HMAC input; Ed25519 is not used.

Authentication remains stateless: the same valid credential can be reused during its permitted time window. There is no session or consumed-signature store. The request data starts as `null` in the plugin's scope, is isolated between requests, and is cleared before every authentication attempt, including a failed revalidation.

## Update error handling

Handle the stable HTTP 401/code `FST_ERR_TMA_UNAUTHORIZED` instead of the two former authentication error codes. Each expected authentication failure includes `WWW-Authenticate: tma` and a generic client message.

Application error handlers can inspect `error.cause` to diagnose the underlying failure. Keep that cause and secret data out of client responses. Registration failures caused by invalid plugin options are startup errors rather than request-time authentication failures.

## Update package and development workflows

Runtime support is Fastify 5 with Node.js LTS lines 22, 24, and 26. The distribution is ESM-only. Use an ESM application and import the package by name; CommonJS output and compatibility are no longer provided.

For development, use Node.js 24.15+ or Node.js 26 to satisfy the current lint tools. That development requirement does not impose the same patch-version floor on library consumers.

The project uses plain `tsc` to emit ESM JavaScript and declarations, with NodeNext resolution and `.js` extensions in relative imports. SmartBundle is removed. Package the root project rather than publishing a separate generated package; its exports point to compiled artifacts, and `prepack` rebuilds them.

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test:coverage
```

`pnpm check` includes the installed packed ESM consumer and its NodeNext type checks. See the [development commands](../README.md#development) for individual checks. To use the local workspace package in the playground:

```bash
pnpm build
pnpm --dir playground dev
```

These commands prepare and verify the project; they do not choose a release version or publish it to npm.
