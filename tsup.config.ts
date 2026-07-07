import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli/index.ts", "src/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Type declarations for the library entry (src/index.ts) so `import { … } from "orgit"`
  // is fully typed. The CLI entry gets them too; harmless.
  dts: true,
  splitting: false,
});
