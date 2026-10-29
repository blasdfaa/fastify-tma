import antfu from '@antfu/eslint-config'

export default antfu({
  isInEditor: false,
  ignores: ['.agents/**', '.claude/**', 'skills-lock.json'],
  typescript: {
    overridesTypeAware: {
      'ts/no-floating-promises': [
        'error',
        {
          allowForKnownSafePromises: [
            { from: 'package', name: 'FastifyInstance', package: 'fastify' },
            { from: 'package', name: 'FastifyReply', package: 'fastify' },
            { from: 'package', name: 'SafePromiseLike', package: 'fastify' },
          ],
        },
      ],
    },
  },
}, {
  files: ['pnpm-workspace.yaml'],
  rules: {
    'pnpm/yaml-enforce-settings': [
      'error',
      {
        settings: { shellEmulator: true },
      },
    ],
  },
})
