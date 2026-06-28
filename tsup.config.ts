import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  dts: true,
  sourcemap: true,
  clean: true,
  // Provided by opencode at runtime; never bundle them.
  // zod is no longer imported directly — it arrives transitively via
  // @opencode-ai/plugin (which re-exports it as `tool.schema`).
  external: ["@opencode-ai/plugin"],
  splitting: false,
  shims: false,
});
