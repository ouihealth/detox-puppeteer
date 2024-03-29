module.exports = {
  maxWorkers: 1,
  testTimeout: 120000,
  verbose: true,
  testRegex: 'e2e/.*test.js',
  reporters: ['detox/runners/jest/reporter'],
  globalSetup: 'detox/runners/jest/globalSetup',
  globalTeardown: 'detox/runners/jest/globalTeardown',
  testEnvironment: 'detox/runners/jest/testEnvironment',
};
