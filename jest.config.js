/** @type {import('jest').Config} */
module.exports = {
  coverageDirectory: "coverage",
  testEnvironment: 'node',
  testRegex: 'src/__tests__/.+\\.test\\.ts',
  collectCoverageFrom: ["src/**/*.{ts,js}", "!src/__tests__/**/*.{ts,js}"],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      isolatedModules: false,
      tsconfig: {
        target: 'esnext',
        module: 'commonjs',
        strict: true,
        esModuleInterop: true,
        types: ['node', 'jest'],
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        ignoreDeprecations: '6.0',
      },
    }],
  },
};
