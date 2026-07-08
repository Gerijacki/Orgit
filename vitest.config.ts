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
      // Entry wiring, type-only modules, tests, and the static HTML asset (a template
      // string, not logic) aren't meaningful coverage targets.
      exclude: [
        "src/**/*.test.ts",
        "src/**/index.ts",
        "src/core/types.ts",
        "src/cli/**",
        "src/server/ui.ts",
      ],
      // Floors just under the current CI-path numbers. Branch counting is stricter under
      // vitest 4 / coverage-v8 4 than v3 (more branch points), so the branch floor is lower
      // than statements/lines by design — the tests didn't shrink, the metric changed.
      thresholds: { statements: 75, branches: 65, functions: 75, lines: 78 },
    },
  },
});
