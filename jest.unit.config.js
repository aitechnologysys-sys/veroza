// Standalone Jest config for unit specs.
//
// The root jest.config.ts requires @nx/jest, which is not installed, so
// `pnpm test` cannot load at all. That is a pre-existing problem with the
// repo's test setup and is deliberately not fixed here. This config exists so
// the specs that do exist can be run:
//
//   pnpm exec jest -c jest.unit.config.js
//
// Type errors are not reported by ts-jest here; tsc remains the type check.
module.exports = {
  rootDir: __dirname,
  testEnvironment: 'node',
  roots: [
    '<rootDir>/apps/backend/src',
    '<rootDir>/apps/orchestrator/src',
    '<rootDir>/libraries/nestjs-libraries/src',
  ],
  testMatch: ['**/*.spec.ts'],
  // Nest entrypoints load this before any decorated class.
  setupFiles: ['reflect-metadata'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      { tsconfig: '<rootDir>/apps/backend/tsconfig.json', diagnostics: false },
    ],
  },
  moduleNameMapper: {
    // ESM-only packages reached through integration.manager's provider imports.
    '^nostr-tools$': '<rootDir>/jest-stubs/esm-module.js',
    '^nostr-tools/(.*)$': '<rootDir>/jest-stubs/esm-module.js',
    '^@gitroom/backend/(.*)$': '<rootDir>/apps/backend/src/$1',
    '^@gitroom/orchestrator/(.*)$': '<rootDir>/apps/orchestrator/src/$1',
    '^@gitroom/nestjs-libraries/(.*)$':
      '<rootDir>/libraries/nestjs-libraries/src/$1',
    '^@gitroom/helpers/(.*)$': '<rootDir>/libraries/helpers/src/$1',
  },
};
