import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// eslint-disable-next-line test/no-import-node-test -- Run installed artifacts without source transforms.
import { it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)

function installedVersion(name) {
  return require(`${name}/package.json`).version
}

it('an installed packed ESM consumer authenticates requests and resolves public types', { timeout: 240_000 }, async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'fastify-tma-package-'))
  try {
    assert.ok(process.env.npm_execpath, 'Run this test through pnpm test:package')
    const packageManager = await realpath(process.env.npm_execpath)
    const isJavaScript = /\.[cm]?js$/.test(packageManager)
    const command = isJavaScript ? process.execPath : packageManager
    const prefix = isJavaScript
      ? [packageManager]
      : []
    const env = { ...process.env, NODE_PATH: '' }
    const runPnpm = (args, cwd) => execFileAsync(command, [
      ...prefix,
      ...args,
    ], {
      cwd,
      env,
      maxBuffer: 10 * 1024 * 1024,
    })
    const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

    // Packing must regenerate the output through the real prepack lifecycle.
    await rm(join(root, 'dist'), { recursive: true, force: true })
    await runPnpm(['pack', '--pack-destination', sandbox], root)
    const archives = (await readdir(sandbox)).filter(name => name.endsWith('.tgz'))
    assert.equal(archives.length, 1)

    await writeFile(join(sandbox, 'package.json'), JSON.stringify({
      name: 'fastify-tma-installed-consumer',
      private: true,
      type: 'module',
      packageManager: metadata.packageManager,
      dependencies: {
        'fastify': installedVersion('fastify'),
        'fastify-tma': `file:${join(sandbox, archives[0])}`,
      },
      devDependencies: {
        '@types/node': installedVersion('@types/node'),
        'typescript': installedVersion('typescript'),
      },
    }, null, 2))
    await runPnpm(['install', '--no-frozen-lockfile'], sandbox)

    await writeFile(join(sandbox, 'consumer.mjs'), `import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import * as tma from 'fastify-tma'

const entry = import.meta.resolve('fastify-tma')
const installedPath = fileURLToPath(entry)
const relativeEntry = relative(process.cwd(), installedPath)
assert.ok(!isAbsolute(relativeEntry) && !relativeEntry.startsWith('..' + sep))
assert.ok(installedPath.includes(sep + 'node_modules' + sep))
assert.equal(new URL(entry).pathname.endsWith('/dist/index.js'), true)
assert.deepEqual(Object.keys(tma), ['fastifyTMA'])
const packageRoot = new URL('../', entry)
const metadata = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'))
assert.equal(metadata.type, 'module')
assert.notEqual(metadata.private, true)
assert.equal(metadata.exports['.'].types, './dist/index.d.ts')
assert.equal(metadata.exports['.'].import, './dist/index.js')
assert.equal(metadata.exports['.'].require, undefined)
assert.equal(metadata.peerDependencies.fastify, '^5.0.0')
await access(new URL(metadata.exports['.'].types, packageRoot))
await assert.rejects(access(new URL('src/index.ts', packageRoot)), { code: 'ENOENT' })

const botToken = '123456789:AAInstalledConsumerToken'
const authDate = Math.floor(Date.now() / 1000)
const params = new URLSearchParams({
  auth_date: String(authDate),
  user: JSON.stringify({ id: 123, first_name: 'Ada' }),
})
const dataCheckString = [...params].map(([key, value]) => key + '=' + value).sort().join('\\n')
const secret = createHmac('sha256', 'WebAppData').update(botToken).digest()
params.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'))

const app = Fastify()
try {
  await app.register(tma.fastifyTMA, { botToken })
  app.get('/', { onRequest: app.tmaAuth }, async request => {
    assert.ok(request.tmaInitData.auth_date instanceof Date)
    return {
      auth_date: request.tmaInitData.auth_date,
      first_name: request.tmaInitData.user?.first_name,
    }
  })
  const accepted = await app.inject({ url: '/', headers: { authorization: 'tma ' + params } })
  assert.equal(accepted.statusCode, 200)
  assert.deepEqual(accepted.json(), {
    auth_date: new Date(authDate * 1000).toISOString(),
    first_name: 'Ada',
  })

  params.set('user', JSON.stringify({ id: 999, first_name: 'Mallory' }))
  const rejected = await app.inject({ url: '/', headers: { authorization: 'tma ' + params } })
  assert.equal(rejected.statusCode, 401)
  assert.equal(rejected.headers['www-authenticate'], 'tma')
  assert.equal(rejected.json().code, 'FST_ERR_TMA_UNAUTHORIZED')
  assert.equal(rejected.json().cause, undefined)
} finally {
  await app.close()
}
`)
    await execFileAsync(process.execPath, ['consumer.mjs'], { cwd: sandbox, env })

    await writeFile(join(sandbox, 'consumer.ts'), `import Fastify from 'fastify'
import { fastifyTMA } from 'fastify-tma'
import type { FastifyTMAOptions, TMAAuthHook, TMAInitData } from 'fastify-tma'

const app = Fastify()
const options: FastifyTMAOptions = { botToken: 'token', expiresIn: 60 }
app.register(fastifyTMA, options)
const hook: TMAAuthHook = app.tmaAuth
app.get('/', { onRequest: hook }, async (request, reply) => {
  const completion: Promise<void> = hook(request, reply)
  const authDate: Date | undefined = request.tmaInitData?.auth_date
  const firstName: string | undefined = request.tmaInitData?.user?.first_name
  // @ts-expect-error The former request helper is removed.
  request.tmaValidate()
  // @ts-expect-error The public data format is snake_case.
  request.tmaInitData?.authDate
  void completion
  return { authDate, firstName }
})
const optionalUser: TMAInitData['user'] = undefined
// @ts-expect-error The former server helper is removed.
app.tma.validate('data', 'token')
// @ts-expect-error Custom decorator names are no longer an option.
const obsolete: FastifyTMAOptions = { botToken: 'token', decoratorName: 'custom' }
// @ts-expect-error TTL is a number of seconds.
const wrongTTL: FastifyTMAOptions = { botToken: 'token', expiresIn: '60' }
void optionalUser
void obsolete
void wrongTTL
`)
    await runPnpm([
      'exec',
      'tsc',
      '--noEmit',
      '--strict',
      '--verbatimModuleSyntax',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--target',
      'ES2022',
      '--types',
      'node',
      'consumer.ts',
    ], sandbox)
  }
  finally {
    await rm(sandbox, { recursive: true, force: true })
  }
})
