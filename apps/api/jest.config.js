// Not: testMatch glob'lari <rootDir> oneki KULLANMAZ. Windows + git worktree yolunda
// (...\.claude\worktrees\...) mutlak yolun backslash'i micromatch'te escape sayilip
// testMatch'i 0 eslesmeye dusuruyordu. Relative glob ('**/...') bu sorunu cozer.
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
      // <rootDir> oneki yok: backslash'li mutlak yol micromatch'i bozmasin (Windows worktree)
      testMatch: ['**/src/**/*.spec.ts'],
    },
    {
      ...base,
      displayName: 'integration',
      testMatch: ['**/test/**/*.int-spec.ts'],
      setupFiles: ['<rootDir>/test/setup-env.ts'],
      globalSetup: '<rootDir>/test/global-setup.ts',
    },
  ],
};
