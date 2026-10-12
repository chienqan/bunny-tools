// e2e for `bunny domain connect`. Currently uncovered at CLI level —
// only exercised via the MCP tool wrapper in mcp.e2e.ts.
//
// Idempotency case (no cert provisioning needed): uses --no-wait so the
// CLI doesn't poll Let's Encrypt. Cert provisioning is fired async and
// will fail in the background for our placeholder hostname (Bunny doesn't
// validate ownership at link time). Bug #4 (rc.39) was that re-running
// `domain connect` created a duplicate DNS record (17002577 + 17002578);
// rc.40 fixed it by pre-checking existing records. This test guards.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bunnyCli, bunnyCliOk } from './helpers/bunny-cli.js';
import { register, cleanupAll } from './helpers/cleanup-registry.js';
import { extractIdNumeric } from './helpers/parse-output.js';
import { suitePrefix, uniqueId } from './helpers/prefix.js';
import { E2E_ENABLED } from './helpers/env-guard.js';

describe.skipIf(!E2E_ENABLED)('e2e: domain connect (idempotency)', () => {
  let pullZoneId = 0;
  let pullZoneName = '';
  // .invalid is RFC 6761 reserved for non-resolvable test domains. Bunny
  // accepts it for hostname registration where .example.com is rejected
  // with `hostname_invalid` (verified live in rc.45). The MCP fixtures
  // also use .invalid for DNS zones for the same reason.
  const fakeHost = `${suitePrefix()}-domain.invalid`;

  beforeAll(async () => {
    pullZoneName = uniqueId('domain-pz');
    const created = await bunnyCliOk([
      'cdn',
      'create',
      pullZoneName,
      '--origin=https://bunny.net',
    ]);
    pullZoneId = extractIdNumeric(created);
    register('cdn', pullZoneId, pullZoneName);
  }, 30000);

  afterAll(async () => {
    // Best-effort: detach hostname before the pull-zone is deleted by
    // cleanup-registry. Hostname removal is non-fatal if it was never linked.
    await bunnyCli(['cdn', 'hostname', 'remove', String(pullZoneId), fakeHost, '--yes']);
    await cleanupAll();
  });

  it('domain connect with --no-wait runs to exit 0 (link only, async cert)', async () => {
    const r = await bunnyCli([
      'domain',
      'connect',
      String(pullZoneId),
      fakeHost,
      '--no-wait',
    ]);
    // We accept exit 0 on success. If Bunny rejects the hostname (rare
    // for placeholder .example.com domains) we surface stderr to triage.
    expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);
  });

  it('domain connect re-run is idempotent — no error, no duplicate hostname', async () => {
    // Second invocation. rc.40 fix: existing-hostname check skips the
    // addHostname API call when already linked, so re-runs don't 4xx.
    const r = await bunnyCli([
      'domain',
      'connect',
      String(pullZoneId),
      fakeHost,
      '--no-wait',
    ]);
    expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);

    // Hostname list should contain exactly one entry for fakeHost. The CLI
    // emits a flat array of strings under --json (the MCP wrapper rewraps
    // it as `{hostnames: [...]}`; CLI is just the array).
    const list = await bunnyCliOk([
      'cdn',
      'hostname',
      'list',
      String(pullZoneId),
      '--json',
    ]);
    const hostnames = JSON.parse(list.stdout) as string[];
    const matches = hostnames.filter((h) => h === fakeHost);
    expect(matches.length).toBe(1);
  });
});
