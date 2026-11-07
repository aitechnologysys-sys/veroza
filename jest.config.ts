// Postaryx divergence: upstream's config calls getJestProjects() from
// `@nx/jest`, which is not a dependency (and no project has its own jest
// config), so `pnpm test` could not start. This is a single plain ts-jest
// project over every *.spec.ts in apps/ and libraries/.
// See docs/UPSTREAM-SYNC.md before taking upstream changes to this file.
export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/apps', '<rootDir>/libraries'],
  testMatch: ['**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/.next/'],
  setupFiles: ['<rootDir>/jest.setup.ts'],
  transform: {
    '^.+\\.(t|j)sx?$': [
      'ts-jest',
      {
        // Type-checking is the builds' job; tests only need to transpile.
        isolatedModules: true,
        tsconfig: {
          allowJs: true,
          esModuleInterop: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          module: 'commonjs',
          target: 'es2021',
        },
      },
    ],
  },
  // ESM-only packages pulled in by nostr-tools (Nostr provider) must be
  // transpiled too, or Jest fails on their `export` syntax.
  transformIgnorePatterns: ['/node_modules/(?!(@noble|@scure|nostr-tools)/)'],
  moduleNameMapper: {
    '^@gitroom/backend/(.*)$': '<rootDir>/apps/backend/src/$1',
    '^@gitroom/frontend/(.*)$': '<rootDir>/apps/frontend/src/$1',
    '^@gitroom/helpers/(.*)$': '<rootDir>/libraries/helpers/src/$1',
    '^@gitroom/nestjs-libraries/(.*)$':
      '<rootDir>/libraries/nestjs-libraries/src/$1',
    '^@gitroom/react/(.*)$': '<rootDir>/libraries/react-shared-libraries/src/$1',
    '^@gitroom/orchestrator/(.*)$': '<rootDir>/apps/orchestrator/src/$1',
    '^@gitroom/extension/(.*)$': '<rootDir>/apps/extension/src/$1',
  },
};
