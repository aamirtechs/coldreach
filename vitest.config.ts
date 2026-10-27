import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Integration suites each run `prisma migrate deploy` in beforeAll
    // (src/lib/testing/testDb.ts). On this VM, with many suites deploying
    // concurrently, the default 10s hook timeout flakes (observed
    // 2026-10-26: the cron route suite timed out in setup under a full
    // run while passing standalone). Match the explicit 120s timeouts
    // several suites already pass to beforeAll.
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
});
