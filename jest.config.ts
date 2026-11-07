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
  // ESM-only packages must be transpiled too, or Jest fails on their `export`
  // syntax: nostr-tools (Nostr provider) and file-type (streaming upload
  // validation, upstream v2.24.0) with their dependencies.
  transformIgnorePatterns: [
    '/node_modules/(?!(@noble|@scure|nostr-tools|file-type|strtok3|token-types|@tokenizer|uint8array-extras|@borewit)/)',
  ],
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
