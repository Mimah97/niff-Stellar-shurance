const base = {
  testEnvironment: "node",
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.test.json", diagnostics: { warnOnly: true } }],
  },
  setupFiles: ["<rootDir>/jest.setup.ts"],
  setupFilesAfterEnv: ["<rootDir>/jest.flaky-retry.js"],
};

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  ...base,
  projects: [
    {
      ...base,
      displayName: "unit",
      roots: ["<rootDir>/src"],
      testMatch: ["**/__tests__/**/*.test.ts", "**/*.test.ts", "**/*.spec.ts"],
      testPathIgnorePatterns: ["/node_modules/", "\\.integration\\.", "\\.e2e\\."],
      coverageDirectory: "<rootDir>/coverage/unit",
      collectCoverageFrom: ["src/**/*.service.ts", "src/**/*.services.ts"],
      coverageThreshold: {
        global: { lines: 80 },
      },
    },
    {
      ...base,
      displayName: "integration",
      roots: ["<rootDir>/test/integration"],
      testMatch: ["**/*.integration.test.ts", "**/*.integration.spec.ts"],
      globalSetup: "<rootDir>/test/setup/global-setup.ts",
      globalTeardown: "<rootDir>/test/setup/global-teardown.ts",
      setupFilesAfterEnv: ["<rootDir>/test/setup/reset-db.ts"],
      maxWorkers: 1,
    },
    {
      ...base,
      displayName: "e2e",
      roots: ["<rootDir>/test/e2e"],
      testMatch: ["**/*.e2e.test.ts", "**/*.e2e.spec.ts"],
      globalSetup: "<rootDir>/test/setup/global-setup.ts",
      globalTeardown: "<rootDir>/test/setup/global-teardown.ts",
      setupFilesAfterEnv: ["<rootDir>/test/setup/reset-db.ts"],
      maxWorkers: 1,
    },
  ],
};
