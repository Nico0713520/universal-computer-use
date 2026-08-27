import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    sequence: {
      concurrent: false,
    },
    testTimeout: 10_000,
  },
});
