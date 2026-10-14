# End-to-End Testing

This is **drift detection**, not unit testing. The unit tests in `test/**/*.test.ts` mock Bunny via undici MockAgent and cannot detect when Bunny.net changes a field name, status code, or endpoint shape. The e2e suite at `test/e2e/**/*.e2e.ts` hits the real Bunny API and fails when our CLI's assumptions stop matching reality.

## Running locally

```bash
# Without BUNNY_E2E set, the entire suite is skipped - safe to run anywhere.
npm run test:e2e

# With BUNNY_E2E=1 + a Bunny account key, the suite runs against the real API.
# Each test creates name-prefixed throwaway resources and cleans them up.
BUNNY_E2E=1 BUNNY_API_KEY=<your-key> npm run test:e2e

# Optional: also run the cert/hostname/domain-connect MCP tests (3 tests,
# skipped otherwise). Needs a domain whose DNS zone is on the same Bunny account; the
# tests add and remove `bt-e2e-*` subdomain hostnames, certificates and records.
BUNNY_E2E=1 BUNNY_API_KEY=<your-key> BUNNY_E2E_DOMAIN=<your-domain> npm run test:e2e
```

Run it before every release; the scheduled `e2e-nightly` workflow is disabled (it can still be triggered manually after re-enabling it in GitHub Actions).

**Expected runtime:** ~1 minute on a good network. Each test creates real Bunny resources, so the suite is rate-limited by Bunny's response time, not local CPU.

**What gets touched on your account:**
- Storage zones, pull zones, DNS zones, Stream libraries, Stream videos, edge scripts
- Every resource is named `bt-e2e-<pid>-<unixts>-<service>-<n>` so it's grep-friendly and trivially distinguishable from real resources
- The DNS test uses a `.invalid` TLD so it never affects real domain routing
- Each test cleans up its own resources via `try/finally`; a suite-level `afterAll` is the backstop

## What the suite covers

| File | Tests | Covers |
| --- | --- | --- |
| `account-readonly.e2e.ts` | 3 | `whoami`, `manifest --names`, `storage zone list` |
| `storage-zones.e2e.ts` | 4 | Zone CRUD + lowercase-region uppercasing (Bug #9 regression) |
| `storage-files.e2e.ts` | 9 | `<zone>/<path>` upload/download/ls/sync/rm, trailing-slash upload, zone-root delete refused, subdir listing (Bug #1), bare `ls <zone>` (Bug #2) |
| `pull-zones.e2e.ts` | 2 | Pull zone CRUD with `--origin` and raw-body update |
| `edge-rules.e2e.ts` | 2 | Edge rule add/list/delete via `/edgerules/addOrUpdate` (Bug #5 regression) |
| `dns.e2e.ts` | 5 | DNS zone + record CRUD with positional args, REDIRECT round-trip |
| `stream.e2e.ts` | 3 | Library CRUD + 8 KB video upload + delete-command-exists (Bug #8 regression) |
| `scripting.e2e.ts` | 1 | Edge script create + upsert-by-name update (Bug #7 regression) + delete |
| `deploy.e2e.ts` | 5 | Full pipeline: dry-run → upload → state-cache hit → modify+redeploy; `init --ci` workflow |
| `domain.e2e.ts` | 2 | `domain connect --no-wait` and idempotent re-run |
| `mcp.e2e.ts` | 18 | MCP tools end-to-end (3 need `BUNNY_E2E_DOMAIN`; 2 are placeholders covered elsewhere and always skip) |

## Provisioning a Bunny account

For contributors who don't have a real account:

1. Sign up at https://bunny.net (free tier supports everything tested except Stream video bandwidth - and the test fixture is 8 KB)
2. Generate an Account API Key in dashboard → Account Settings → API
3. Export it: `export BUNNY_API_KEY=<your-key>`
4. Run the suite: `BUNNY_E2E=1 npm run test:e2e`

## Adding a new service

Each `*.e2e.ts` file is independent - adding a new service is one file with no harness changes:

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { bunnyCliOk } from './helpers/bunny-cli.js';
import { register, cleanupAll } from './helpers/cleanup-registry.js';
import { extractIdNumeric } from './helpers/parse-output.js';
import { uniqueId } from './helpers/prefix.js';
import { E2E_ENABLED } from './helpers/env-guard.js';

describe.skipIf(!E2E_ENABLED)('e2e: <new service>', () => {
  afterAll(async () => { await cleanupAll(); });

  it('CRUD round-trip', async () => {
    const created = await bunnyCliOk(['<service>', 'create', uniqueId('foo')]);
    const id = extractIdNumeric(created);
    register('<service>', id);
    // assert response shape
    await bunnyCliOk(['<service>', 'delete', String(id), '--yes']);
  });
});
```

If the new service needs a cleanup routine, add the type to `helpers/cleanup-registry.ts:ResourceType` and `helpers/stale-sweep.ts:listResources`.

## Interpreting failures

| Failure pattern | Likely cause |
| --- | --- |
| `[error] Bunny rejected credentials (HTTP 401)` shortly after creation | Resource newly created - needs ~5s propagation. Already handled in beforeAll for storage + stream; if a new test fails like this, add a `setTimeout` after creation |
| `HTTP 404` on read after delete | Eventual consistency - usually self-resolves in <1s; only flaky for zones in heavy DELETE/POST patterns |
| `unknown command` | Registry mismatch - the e2e file references a command that's not `active` in `src/manifest/registry.ts`. Either promote the command or skip the test |
| `HTTP 400` with field-level error | Bunny schema drift OR our request body shape is wrong. Cross-check with `curl` against the same endpoint |
| Multiple tests fail with `bt-e2e-*` orphans accumulating | Cleanup registry isn't being called - check that `afterAll(cleanupAll)` is at the file level, not inside a nested `describe` |

## CI flow

`.github/workflows/e2e-nightly.yml` runs the same suite on a 03:00 UTC schedule plus `workflow_dispatch`. **It is currently disabled** (each run creates and deletes real resources on the account behind the secret); re-enable it under Actions → e2e-nightly → "Enable workflow". On failure, it opens a GitHub issue labeled `e2e,drift` with the failure log and a link to the run.

**Required secret:** `BUNNY_E2E_API_KEY` (optional: `BUNNY_E2E_DOMAIN`) - set in GitHub repo Settings → Secrets and variables → Actions. Use a dedicated test-account key where possible.

**Manual trigger:** Actions tab → "e2e-nightly" → "Run workflow" button. Useful for verifying the workflow + secret without waiting for the nightly cron.

**Rotating the secret:** when the account key rotates, just update the GitHub secret - no code changes needed.

## Stale resource sweep

Vitest's `globalSetup` (`test/e2e/helpers/stale-sweep.ts`) runs once before each suite invocation and deletes any `bt-e2e-*` resource older than 24 hours. This catches orphans from earlier runs that crashed before their cleanup phase. The sweep only touches resources whose names match the prefix shape; user resources are never affected.

## Constraints

- **Sequential only.** `pool: 'forks', singleFork: true` keeps the whole suite serial. Parallel runs would thrash Bunny's rate limiter and race on listing endpoints. If you need to parallelize for speed later, isolate each runner to a unique prefix root via `BT_E2E_PREFIX`.
- **No fake mode.** This suite hits real Bunny by design. To test locally without a Bunny account, run the unit suite (`npm test`) - that's what mocks are for.
- **Containers app create is `.skip`-ed** until Bunny's v3 schema rewrite lands in v0.2.
