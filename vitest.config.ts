import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
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
