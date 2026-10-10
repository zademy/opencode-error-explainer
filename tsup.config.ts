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
  external: ["@opencode/plugin"],
  splitting: false,
  shims: false,
});
