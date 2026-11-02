import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "src-tauri/src/**/*.test.mjs",
      "src/**/*.{test,spec}.{ts,tsx}",
    ],
    environment: "node",
    coverage: {
      provider: "v8",
      // Scripts evaluated through node:vm are not instrumented by Vitest.
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/main.ts"],
      reporter: ["text", "json-summary"],
    },
  },
});
