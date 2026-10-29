## Problem Statement

fastify-tma needs a maintainable, tested foundation before its next public npm release. Its current Telegram SDK dependency is deprecated, its only test is a placeholder, and its examples and development workflow do not establish that a consumer can reliably install and use the published package.

The current authentication API also has correctness problems: expected authentication failures become HTTP 500 responses, custom request decorator names are not respected when attaching data, repeated validation can retain previously authenticated data after failure, and the documented synchronous hook can stop the Fastify lifecycle from continuing. The CI matrix does not pass its intended Node.js version to the setup action.

Application developers need a small authentication interface with explicit rules for signatures, timestamps, errors, request state, and route protection. Maintainers need evidence that the compiled ESM package and its TypeScript declarations work outside the repository.

## Solution

Prepare a release-ready Fastify 5 plugin for supported Node.js LTS lines 22, 24, and 26. Provide an asynchronous `fastify.tmaAuth` hook that verifies Telegram init data using the configured bot token, parses authenticated data, and attaches it to the fixed `request.tmaInitData` property.

Use the SDK's native snake_case fields, preserve `auth_date` as a `Date`, make timestamp and TTL policies explicit, and expose one consistent HTTP authentication error. Keep authentication stateless and let applications select protected routes through ordinary Fastify hook registration and encapsulation.

Breaking API changes are accepted. Replace the previous helper-based API and SmartBundle build with this smaller interface and a plain TypeScript ESM build. Establish release readiness through real HMAC integration tests, public type checks, an installed packed-package consumer, CI, migration guidance, and a final code review. This specification does not authorize npm publication.

## User Stories

1. As a maintainer, I want compatible, maintained dependencies, so that I can prepare a public npm release without relying on the deprecated Telegram SDK namespace.
2. As an application developer, I want a deliberately small authentication API, so that I can adopt the new contract without carrying obsolete compatibility helpers.
3. As an application developer, I want the plugin to support Fastify 5, so that I can register it in an application using that major version.
4. As an application operator, I want runtime support for Node.js LTS lines 22, 24, and 26, so that I can deploy on the agreed supported environments.
5. As an application developer, I want to configure my bot token during plugin registration, so that the hook verifies init data for my bot.
6. As an application developer, I want an optional positive integer TTL in seconds with a one-hour default, so that I can choose the permitted age of authenticated data.
7. As an application operator, I want invalid plugin options to fail registration, so that configuration mistakes are detected before requests are served.
8. As an application developer, I want a ready-to-use asynchronous authentication hook, so that successful and failed requests follow the Fastify lifecycle correctly.
9. As an application developer, I want to attach authentication to individual routes or a Fastify scope, so that public routes and sibling scopes remain unaffected.
10. As an application developer, I want authentication to accept only one nonempty init-data credential in the Authorization header, so that missing credentials, extra credentials, and fallback transports cannot create ambiguous behavior.
11. As an HTTP client developer, I want the `tma` authentication scheme to be case-insensitive, so that the plugin follows HTTP authentication semantics.
12. As an application developer, I want HMAC verification to use the original init-data string, so that normalization cannot change what was authenticated.
13. As an application developer, I want modified data and data signed with another bot token to be rejected, so that untrusted information is not attached to the request.
14. As an application developer, I want the TTL boundary to be inclusive, so that data exactly as old as the configured TTL has a defined outcome.
15. As an application operator, I want future authentication timestamps to be limited to 60 seconds inclusively, so that a small clock difference is tolerated without accepting arbitrarily future-dated data.
16. As an application developer, I want `auth_date` to be a strict integer Unix timestamp, so that fractional, empty, and partially parsed timestamps are rejected.
17. As an application developer, I want duplicate init-data query keys to be rejected, including unknown keys, so that different interpretations of the same input cannot affect authentication.
18. As an application developer, I want correctly HMAC-signed legacy init data without `signature` to remain usable, so that the parser's structural requirement does not reject otherwise supported credentials.
19. As an application developer, I want parsed data to retain the SDK's snake_case names, so that the plugin does not introduce its own field-renaming layer.
20. As a TypeScript consumer, I want `auth_date` to remain a `Date`, so that its runtime value and declared type agree.
21. As an application developer, I want valid init data without `user` to be accepted, so that my application can decide whether a user identity is required.
22. As an application developer, I want a supplied but malformed user object to be rejected, so that authenticated data also satisfies the parser's structure requirements.
23. As an application developer, I want `request.tmaInitData` to be `null` before authentication in the plugin's scope, so that its initial state is predictable.
24. As an application developer, I want each authentication attempt to clear previously attached data, so that catching a failed revalidation does not leave stale trusted data on the request.
25. As an application developer, I want authenticated data to be isolated between requests, so that concurrent requests cannot share authentication state.
26. As an HTTP client developer, I want expected authentication failures to return HTTP 401 with one stable error code and a generic message, so that I can handle rejection consistently.
27. As an HTTP client developer, I want a `WWW-Authenticate: tma` challenge on authentication failures, so that the 401 response identifies the applicable scheme.
28. As an application developer, I want the original authentication failure available through `cause` without disclosing it in the client response, so that I can diagnose failures through my application's error handling.
29. As an application developer, I want valid credentials to be reusable within their TTL, so that this stateless plugin does not require a replay database or session store.
30. As a package consumer, I want an ESM-only distribution, so that the package has one supported JavaScript module format.
31. As a TypeScript consumer, I want public options, hook types, parsed data types, and Fastify augmentation to resolve from the installed package, so that I do not need repository sources to type-check my application.
32. As a maintainer, I want the former request validator, low-level server validator, and custom decorator option removed, so that the documented public surface matches the agreed API.
33. As a maintainer, I want plain `tsc` to emit ESM and declarations, so that this small library does not need a bundler or dual-format build pipeline.
34. As a package consumer, I want root package exports to resolve to compiled artifacts with the required metadata and Fastify peer dependency, so that installation exposes a usable library.
35. As a maintainer, I want packaging to build fresh artifacts through `prepack`, so that the packed package does not depend on stale or missing output.
36. As a contributor, I want the playground to use the local workspace package after building and declare its own CLI dependencies, so that its documented startup command exercises the project under development.
37. As a maintainer, I want HTTP integration tests with independently generated real HMAC signatures, so that they verify the authentication contract rather than mocked SDK calls.
38. As a maintainer, I want a separately installed packed ESM consumer to exercise runtime behavior and NodeNext declarations, so that workspace resolution cannot hide packaging defects.
39. As a maintainer, I want CI to check the supported Node.js lines while keeping development-tool requirements separate from runtime support, so that a newer linter does not unnecessarily restrict package consumers.
40. As an application developer, I want migration guidance for the accepted breaking changes, so that I can replace the old hooks, names, options, and error handling deliberately.

## Implementation Decisions

- **Public surface:** expose the asynchronous `fastify.tmaAuth` hook and fixed `request.tmaInitData` field. Remove `request.tmaValidate`, `fastify.tma.validate`, and `decoratorName`; do not add public parsing or validation helpers.
- **Hook application:** applications opt in through route-level or scoped Fastify hook registration. Plugin registration alone must not authenticate all routes. Preserve ordinary Fastify encapsulation.
- **Options:** require a nonempty string `botToken`. Accept optional `expiresIn`, defaulting to 3600 seconds. It must be a finite positive integer; zero, negative or fractional values, `NaN`, `Infinity`, and other types fail registration. Configuration errors are startup errors, not authentication responses.
- **Input boundary:** accept only `Authorization: tma <rawInitData>` with one nonempty credential. Compare the scheme case-insensitively. Reject absent credentials, unsupported schemes, and additional credentials. Do not read authentication credentials from cookies, query parameters, or request bodies.
- **Verification:** use HMAC with the configured bot token and authenticate the original credential string. Inspect input without rewriting what is signed; perform any compatibility normalization only after successful verification of the original data.
- **SDK migration:** replace the deprecated Telegram SDK namespace with `@tma.js/init-data-node`. Use its native parser and data types without a camelCase adapter or a direct toolkit dependency for renaming fields.
- **Timestamp validation:** require `auth_date` to represent an integer Unix timestamp in seconds. Reject empty, nonnumeric, fractional, and numeric-prefix-with-trailing-garbage values rather than relying on permissive `parseInt` behavior.
- **Time window:** accept creation times no older than `expiresIn` seconds and no more than 60 seconds ahead of server time. Both boundaries are inclusive. With the default TTL, exactly 3600 seconds old is accepted and anything older is rejected; exactly 60 seconds ahead is accepted and anything further ahead is rejected. Do not round time in a way that widens the permitted window.
- **Duplicates:** reject repeated init-data query keys regardless of whether the key is recognized by the SDK. This includes `hash`, `auth_date`, `signature`, and unknown fields. The plugin must enforce this rule explicitly.
- **Legacy compatibility:** accept valid HMAC-signed init data without `signature`. If needed for the SDK parser, add the absent field with an empty string to a copy of the parameters only after authenticating the original string. A supplied `signature` remains part of the original HMAC input; Ed25519 validation is not performed.
- **Parsed data:** attach native snake_case data, preserving `auth_date` as a `Date`. An absent `user` is valid; a supplied user must pass the parser's structure checks. Requiring a user identity is an application-level authorization decision.
- **Request state:** initialize the fixed data field to `null` in the registered plugin scope. Clear it before every hook invocation, including attempts that fail before signature verification. Attach a newly parsed value only after all authentication and structure checks succeed; never share mutable parsed data between requests.
- **Failure contract:** expected authentication failures return HTTP 401, code `FST_ERR_TMA_UNAUTHORIZED`, a generic client-facing message, and `WWW-Authenticate: tma`. Retain the underlying cause for application error handling without serializing it or secret data into the client response. Existing authentication error codes are not preserved.
- **Stateless operation:** a correctly signed credential may be used repeatedly within its permitted time window. Do not add session state, consumed-signature tracking, revocation storage, or replay prevention.
- **Runtime support:** support Fastify 5 and Node.js LTS lines 22, 24, and 26. Declare Fastify as a peer dependency. Derive runtime requirements from production code and dependencies rather than from the linter's minimum patch version.
- **Development dependencies:** use a compatible maintained toolchain. The researched TypeScript 6 and Vitest 5 combination is suitable for validation; removing SmartBundle removes its previous Vitest 3/4 constraint. Development with the researched Antfu configuration requires an appropriately recent Node.js version, such as Node 24.15+ or Node 26, separately from the package's runtime contract.
- **Build:** use plain `tsc`, with NodeNext module and resolution behavior, an ES2022 target, and declaration emit. Use `.js` extensions in relative module specifiers so emitted imports work in Node ESM. Keep Fastify augmentation reachable from the public declarations. Build production code separately from no-emit test type checking.
- **Distribution:** publish the root package as ESM with exports targeting compiled JavaScript and declarations. Use an allowlist for compiled distribution artifacts, preserve license and repository metadata, declare production dependencies, and build through `prepack`. Do not generate a second publishable package or CommonJS output.
- **Playground and documentation:** use `workspace:*` to select the local root package and its compiled exports after building. Declare the playground's necessary CLI and pretty-printing dependencies. Replace old authentication examples and document breaking API, field-name, option, and error changes.
- **Release preparation:** update compatible dependencies and the lockfile, repair the CI matrix variable mismatch, review the completed implementation against this contract and repository standards, inspect the tarball, and audit the resulting dependency tree. Record actual validation outcomes and unresolved blockers; do not infer them from this specification.

## Testing Decisions

- **Primary seam, already agreed:** test the public plugin through actual `Fastify.register` and `inject` calls. Observe HTTP responses, request data in application handlers, startup failures, and encapsulation. Do not introduce a lower-level public seam merely to make tests easier.
- **Real cryptography:** calculate Telegram HMAC signatures independently of the production validator. Exercise the real SDK and parser rather than mocking successful validation. Test valid credentials, mutation after signing, and a different bot token.
- **Existing prior art:** the repository currently has only a placeholder unit test and no meaningful authentication or installed-package test pattern to preserve. Fastify injection is the established framework seam for the new behavioral suite. Close application instances after tests.
- **Options and startup:** cover missing, empty, and incorrectly typed tokens; default and custom TTL; and zero, negative, fractional, nonfinite, or incorrectly typed TTL values. Assert that invalid options fail registration rather than producing request-time 401 responses.
- **Lifecycle and scope:** use the ready asynchronous hook directly as a route hook and a scoped hook. Assert that successful requests finish, rejected requests do not reach the protected handler, unprotected routes remain available, and sibling scopes remain unaffected.
- **Header contract:** cover missing or empty headers, another scheme, empty init data, extra credentials, and case variants such as `tma` and `TMA`. Credentials placed only in a cookie, query, or body must not authenticate a request.
- **Temporal boundaries:** control the server clock. For the default TTL, ages 3599, 3600, and 3601 seconds must respectively pass, pass, and fail. Test the exact boundary and an excess for a custom TTL. Future offsets of 59, 60, and 61 seconds must respectively pass, pass, and fail; include millisecond boundaries to catch unwanted rounding.
- **Input structure:** reject missing or empty signature hashes, missing or invalid timestamps, fractions and numeric suffix garbage, duplicate known and unknown query keys, malformed JSON, and invalid supplied user shapes. Use correctly signed fixtures where necessary to demonstrate structure policy rather than merely a bad HMAC.
- **Native data and legacy input:** assert snake_case nested fields and a real `Date` for `auth_date`. Valid data without `user` must pass; an empty user object must not be treated as absence. Verify both valid legacy input without `signature` and signed input containing it.
- **State and reuse:** assert initial `null`, successful attachment, isolation between concurrent requests, and clearing after failed revalidation of the same request, including malformed-header and invalid-data failures. Reusing the same valid credential inside its TTL must pass; using it after expiry must fail.
- **Failure visibility:** assert the single 401 status/code, generic message, and challenge header for expected authentication failures. An application error handler must be able to inspect `cause`; the client response must not expose that cause or secrets.
- **Public types:** check plugin options, the asynchronous hook's compatibility with Fastify, reachable augmentation, snake_case fields, optional `user`, and `Date`. The former helper APIs and custom decorator option must not remain part of the public type contract.
- **Distribution seam, already agreed:** pack the project, install the tarball into a separate ESM consumer, import it by package name, and exercise successful and rejected requests. Type-check that installed consumer under NodeNext. Do not rely on repository source imports or workspace symlinks for this check.
- **CI and coverage:** run appropriate checks on current patch releases of Node.js 22, 24, and 26, with compatible tooling. Cover the agreed behavioral branches; no numeric coverage target or predetermined test count is promised. CommonJS consumer tests are unnecessary because CommonJS is outside the contract.

## Out of Scope

- Publishing to npm as part of this specification task, or choosing the future release version in advance.
- Backward compatibility with `request.tmaValidate`, `fastify.tma.validate`, `decoratorName`, camelCase parsed data, or the old authentication error codes.
- CommonJS output, CommonJS compatibility guarantees, SmartBundle, or another bundler.
- Ed25519 or third-party verification, a public hashed-token mode, or low-level public signing, parsing, and validation helpers.
- Authentication fallback through cookies, query parameters, request bodies, or another authorization scheme.
- Requiring `user` or `user.id` for every authenticated request; applications own that authorization decision.
- Sessions, a replay store, one-time credential semantics, consumed-signature tracking, or other stateful authentication behavior.
- Automatic protection of all routes merely because the plugin is registered.
- Unagreed features beyond HMAC verification, parsing, request data attachment, and the ready authentication hook.

## Further Notes

This specification synthesizes the accepted design interview and a research snapshot dated 29 October 2026, including a review of the original code. Both testing seams were agreed during that discussion.

The source baseline is commit `d91820f65619608dcb218e57f11d27de794e5dbf`. This document describes future work; it does not claim that implementation, dependency updates, validation, or npm publication has occurred. The release version remains undecided.

The SDK's HMAC validator does not enforce the agreed future-time limit, strict timestamp syntax, or a blanket duplicate-key prohibition. Its parser requires a `signature` string even though HMAC verification can accept input without it. These differences must be handled at the plugin boundary rather than assumed to be upstream behavior.

Primary references: [published SDK 2.0.8 metadata](https://registry.npmjs.org/@tma.js%2finit-data-node/2.0.8) and [tarball](https://registry.npmjs.org/@tma.js/init-data-node/-/init-data-node-2.0.8.tgz), [Fastify hooks](https://fastify.dev/docs/latest/Reference/Hooks/), [RFC 9110 authentication schemes](https://www.rfc-editor.org/rfc/rfc9110.html#section-11.1) and [401 responses](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.5.2), [TypeScript module reference](https://www.typescriptlang.org/docs/handbook/modules/reference.html), and [Node.js ESM import requirements](https://nodejs.org/docs/latest-v22.x/api/esm.html#mandatory-file-extensions).

The research records package versions observed on 29 October 2026. Recheck published metadata and dependency compatibility during implementation instead of treating that version snapshot as a permanent lockfile. Audit and coverage results must be reported from the eventual implementation; none are asserted here.
