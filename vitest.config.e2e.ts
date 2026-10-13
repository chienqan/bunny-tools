// Separate vitest config for end-to-end tests that hit the real Bunny.net
// API. Gated on `BUNNY_E2E=1` via setupFiles. The regular `vitest.config.ts`
// includes only `test/**/*.test.ts`; this one targets `*.e2e.ts` so the
// two suites never overlap.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/e2e/**/*.e2e.ts'],
    setupFiles: ['./test/e2e/helpers/env-guard.ts'],
    globalSetup: ['./test/e2e/helpers/stale-sweep.ts'],
    // Deploy + video upload spawns can run >5s. Keep generous limits so the
    // suite isn't flaky on slow networks.
    testTimeout: 60000,
    hookTimeout: 60000,
    // Sequential — Bunny rate-limits, and our resources collide on lookup
    // otherwise (e.g. listing right after deletion sometimes 404s).
    // Vitest 4 dropped `poolOptions.forks.singleFork`; running files one at a
    // time is now `fileParallelism: false`.
    pool: 'forks',
    fileParallelism: false,
  },
});
