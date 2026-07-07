import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // E2E tests spawn real subprocesses (git, the CLI via tsx), so allow headroom.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      // Entry wiring, type-only modules, and tests aren't meaningful coverage targets.
      exclude: ["src/**/*.test.ts", "src/**/index.ts", "src/core/types.ts", "src/cli/**"],
      // A ratchet: set just under today's numbers so coverage can only go up.
      thresholds: { statements: 75, branches: 75, functions: 80, lines: 75 },
    },
  },
});
