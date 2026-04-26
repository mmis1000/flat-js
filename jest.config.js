/** @type {import('jest').Config} */
module.exports = {
  coverageDirectory: "coverage",
  testEnvironment: 'node',
  testRegex: '(src|web)/__tests__/.+\\.test\\.ts',
  collectCoverageFrom: ["src/**/*.{ts,js}", "!src/__tests__/**/*.{ts,js}"],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      isolatedModules: false,
    }],
  },
};
