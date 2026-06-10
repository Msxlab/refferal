const base = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    // Testlerde shared'in build edilmis dist'i degil kaynaklari kullanilir
    '^@refearn/shared$': '<rootDir>/../../packages/shared/src/index.ts',
  },
};

/** @type {import('jest').Config} */
module.exports = {
  testTimeout: 60000,
  projects: [
    {
      ...base,
      displayName: 'unit',
      testMatch: ['<rootDir>/src/**/*.spec.ts'],
    },
    {
      ...base,
      displayName: 'integration',
      testMatch: ['<rootDir>/test/**/*.int-spec.ts'],
      setupFiles: ['<rootDir>/test/setup-env.ts'],
      globalSetup: '<rootDir>/test/global-setup.ts',
    },
  ],
};
