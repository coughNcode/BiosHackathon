import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/red.test.ts", "node_modules", "dist"],
    fileParallelism: false,
  },
});
