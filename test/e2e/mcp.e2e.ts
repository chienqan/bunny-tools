import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bunnyCliOk } from './helpers/bunny-cli.js';
import { register, cleanupAll } from './helpers/cleanup-registry.js';
import { spawnMcpClient, unwrapJson, type McpHandle } from './helpers/mcp-client.js';
import { extractIdNumeric } from './helpers/parse-output.js';
import { suitePrefix, uniqueId } from './helpers/prefix.js';
import { E2E_ENABLED } from './helpers/env-guard.js';

// e2e for the MCP server end of bunny-tools. Spawns `bunny mcp`, connects
// the SDK Client over stdio, and exercises every active MCP tool against
// the real account. Catches drift the CLI e2e suite can't see — schema
// validation, output serialization, and error envelopes are wrapper-layer
// concerns that don't surface through CLI tests.
//
// Storage tests need no zone password in the MCP server's env: storage
// tools fetch it with the account API key on demand. beforeAll creates a
// throwaway zone via the CLI and spawns the MCP server with only the
// parent env, so the automatic password fallback is exercised too.

describe.skipIf(!E2E_ENABLED)('e2e: MCP server', () => {
  let mcp: McpHandle;
  let storageZoneId = 0;
  let storageZoneName = '';
  let dnsZoneId = 0;
  let pullZoneId = 0;
  let pullZoneName = '';
  const dnsDomain = `${suitePrefix()}-mcp.invalid`;
  // Reuses chien.do's first pull zone for the purge test; only purge
  // accepts a fictional URL without setup. Other write ops use throwaway
  // resources we create + delete here.
  const KNOWN_PURGE_URL = 'https://chien.b-cdn.net/no-such-file.js';

  beforeAll(async () => {
    // 1. Create a throwaway storage zone via the CLI. Cleanup-registry
    // tracks both this zone and the DNS zone we'll create below.
    storageZoneName = uniqueId('mcp-zone');
    const created = await bunnyCliOk(['storage', 'zone', 'create', storageZoneName]);
    storageZoneId = extractIdNumeric(created);
    register('storage-zone', storageZoneId, storageZoneName);

    // 2. Same trick for DNS — pre-create a `.invalid` zone we can mutate
    // safely. Skipping DNS-zone create via MCP because our CLI suite
    // already covers that path; this file focuses on the MCP wrapper layer.
    const dnsCreated = await bunnyCliOk(['dns', 'create', dnsDomain]);
    dnsZoneId = extractIdNumeric(dnsCreated);
    register('dns', dnsZoneId, dnsDomain);

    // 2b. Throwaway PZ for hostname round-trip + enable-ssl tests. Origin
    // is bunny.net (an arbitrary reachable host); we never serve traffic
    // through it, just exercise the hostname-list/add/remove/enable-ssl path.
    pullZoneName = uniqueId('mcp-pz');
    const pzCreated = await bunnyCliOk([
      'cdn',
      'create',
      pullZoneName,
      '--origin=https://bunny.net',
    ]);
    pullZoneId = extractIdNumeric(pzCreated);
    register('cdn', pullZoneId, pullZoneName);

    // 2c. Auto-resolve BUNNY_E2E_DNS_ZONE_ID from BUNNY_E2E_DOMAIN. Pre-rc.52
    // both had to be supplied as separate env vars even though the id is
    // trivially derivable from the domain (one dns list call). Now we
    // resolve once here and stuff the result into env so all gated tests
    // pick it up. Explicit BUNNY_E2E_DNS_ZONE_ID still wins (escape hatch
    // for pointing at a non-canonical zone).
    const e2eDomain = process.env['BUNNY_E2E_DOMAIN'];
    if (e2eDomain && !process.env['BUNNY_E2E_DNS_ZONE_ID']) {
      try {
        const dnsList = await bunnyCliOk(['dns', 'list', '--json']);
        const zones = JSON.parse(dnsList.stdout) as Array<{ Id: number; Domain: string }>;
        const matched = zones.find((z) => z.Domain === e2eDomain);
        if (matched) {
          process.env['BUNNY_E2E_DNS_ZONE_ID'] = String(matched.Id);
        }
        // No-match path: leave DNS_ZONE_ID unset; gated tests skip cleanly.
      } catch {
        // Best-effort. If dns list fails (api-key issue, etc.) just
        // leave DNS_ZONE_ID unset and let the cert tests skip.
      }
    }

    // 3. Bunny propagates storage-zone passwords into the data plane on a
    // ~5-second delay. Without this wait, the first MCP storage_upload
    // returns 401 even though the password is correct.
    await new Promise((r) => setTimeout(r, 6000));

    // 4. Spawn the MCP server. No storage password is injected; the server
    // resolves it from the account API key.
    mcp = await spawnMcpClient();
  }, 90000);

  afterAll(async () => {
    // rc.55: timeout-protect mcp.close() so cleanupAll() always runs.
    // Pre-rc.55 a hung MCP transport could swallow the rest of afterAll,
    // leaving 3 resources orphaned (1× storage zone + 1× pull zone + 1×
    // DNS zone). With this guard, even a frozen close() releases control
    // after 5s and Bunny resources still get torn down.
    if (mcp) {
      await Promise.race([
        mcp.close(),
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ]).catch(() => {
        // Best-effort. mcp.close() throwing or timing out is non-fatal —
        // the child process is killed by the test runner anyway.
      });
    }
    await cleanupAll();
  });

  // -----------------------------------------------------------------------
  // Handshake — proves the MCP server registers all expected tools.
  // -----------------------------------------------------------------------

  it('listTools returns ≥17 active tools (rc.37)', async () => {
    const result = await mcp.client.listTools();
    expect(result.tools.length).toBeGreaterThanOrEqual(17);
    const names = result.tools.map((t) => t.name);
    // Spot-check a handful — full list locked down in unit tests.
    expect(names).toContain('bunny.manifest');
    expect(names).toContain('bunny.deploy');
    expect(names).toContain('bunny.purge');
    expect(names).toContain('bunny.storage_ls');
    expect(names).toContain('bunny.storage_upload');
    expect(names).toContain('bunny.storage_rm');
    expect(names).toContain('bunny.storage_zone_list');
    expect(names).toContain('bunny.storage_zone_create');
    expect(names).toContain('bunny.storage_zone_delete');
    expect(names).toContain('bunny.cdn_list');
    expect(names).toContain('bunny.dns_list');
    expect(names).toContain('bunny.dns_record_add');
    expect(names).toContain('bunny.dns_record_delete');
    // rc.25 / rc.37: hostname tools (enable_ssl + force_ssl rolled into add).
    expect(names).toContain('bunny.cdn_hostname_list');
    expect(names).toContain('bunny.cdn_hostname_add');
    expect(names).toContain('bunny.cdn_hostname_remove');
    // rc.34: atomic Connect Domain.
    expect(names).toContain('bunny.domain_connect');
    // rc.37: enable_ssl + force_ssl are GONE — rolled into add.
    expect(names.filter((n) => /enable_ssl|force_ssl/.test(n))).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Read-only tools — pure introspection paths. Failures here mean
  // serialization regressions, not credential issues.
  // -----------------------------------------------------------------------

  it('bunny.run executes whoami end-to-end', async () => {
    const r = await mcp.client.callTool({
      name: 'bunny.run',
      arguments: { args: ['whoami'] },
    });
    const payload = unwrapJson<{ exitCode: number; stdout: string }>(
      r as { content?: Array<{ type: string; text?: string }> },
    );
    expect(payload.exitCode).toBe(0);
    expect(payload.stdout).toMatch(/account/i);
  });

  it('bunny.manifest returns the registry with ≥40 commands', async () => {
    const r = await mcp.client.callTool({ name: 'bunny.manifest', arguments: {} });
    const reg = unwrapJson<{ commands: Array<{ name: string }> }>(
      r as { content?: Array<{ type: string; text?: string }> },
    );
    expect(reg.commands.length).toBeGreaterThanOrEqual(40);
  });

  it('bunny.storage_zone_list returns array including our test zone (passwords stripped)', async () => {
    const r = await mcp.client.callTool({ name: 'bunny.storage_zone_list', arguments: {} });
    const zones = unwrapJson<Array<Record<string, unknown>>>(
      r as { content?: Array<{ type: string; text?: string }> },
    );
    expect(Array.isArray(zones)).toBe(true);
    const mine = zones.find((z) => z['Id'] === storageZoneId);
    expect(mine).toBeDefined();
    // Zone passwords never leave the server; storage tools fetch them on demand.
    expect(mine).not.toHaveProperty('Password');
    expect(mine).not.toHaveProperty('ReadOnlyPassword');
  });

  it('bunny.cdn_list returns array including our test pull zone', async () => {
    const r = await mcp.client.callTool({ name: 'bunny.cdn_list', arguments: {} });
    const zones = unwrapJson<Array<{ Id: number }>>(
      r as { content?: Array<{ type: string; text?: string }> },
    );
    expect(Array.isArray(zones)).toBe(true);
    expect(zones.some((z) => z.Id === pullZoneId)).toBe(true);
  });

  it('bunny.storage_ls without target lists zones (passwords stripped)', async () => {
    const r = await mcp.client.callTool({ name: 'bunny.storage_ls', arguments: {} });
    const zones = unwrapJson<Array<Record<string, unknown>>>(
      r as { content?: Array<{ type: string; text?: string }> },
    );
    const mine = zones.find((z) => z['Name'] === storageZoneName);
    expect(mine).toBeDefined();
    expect(mine).not.toHaveProperty('Password');
    expect(mine).not.toHaveProperty('ReadOnlyPassword');
  });

  it('bunny.dns_list returns all zones when zone omitted', async () => {
    const r = await mcp.client.callTool({ name: 'bunny.dns_list', arguments: {} });
    const zones = unwrapJson<Array<{ Id: number; Domain: string; records: number }>>(
      r as { content?: Array<{ type: string; text?: string }> },
    );
    expect(Array.isArray(zones)).toBe(true);
    expect(zones.some((z) => z.Id === dnsZoneId)).toBe(true);
  });

  it('bunny.dns_list returns just records when zone given', async () => {
    const r = await mcp.client.callTool({
      name: 'bunny.dns_list',
      arguments: { zone: dnsZoneId },
    });
    const records = unwrapJson<Array<{ Id: number }>>(
      r as { content?: Array<{ type: string; text?: string }> },
    );
    expect(Array.isArray(records)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Storage tools — exercise the storage:<zone> credential resolver.
  // -----------------------------------------------------------------------

  it('bunny.storage_upload, storage_ls, storage_rm round-trip (password auto-fetched)', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'bt-mcp-storage-'));
    const localPath = join(tmp, 'mcp-test.txt');
    await writeFile(localPath, 'mcp-smoke');

    try {
      // Upload
      const up = await mcp.client.callTool({
        name: 'bunny.storage_upload',
        arguments: { local: localPath, target: `${storageZoneName}/mcp-test.txt` },
      });
      // Surface the full response on error so failures are debuggable —
      // storage env propagation is the most likely failure mode here.
      if ((up as { isError?: boolean }).isError) {
        const text = (up as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? '';
        throw new Error(`storage_upload returned isError: ${text}`);
      }
      const upRes = unwrapJson<{ zone: string; path: string }>(
        up as { content?: Array<{ type: string; text?: string }> },
      );
      expect(upRes.zone).toBe(storageZoneName);
      expect(upRes.path).toBe('/mcp-test.txt');

      // List — confirm the file appears
      const list = await mcp.client.callTool({
        name: 'bunny.storage_ls',
        arguments: { target: storageZoneName },
      });
      const entries = unwrapJson<Array<{ path?: string; size?: number; isDirectory?: boolean }>>(
        list as { content?: Array<{ type: string; text?: string }> },
      );
      expect(Array.isArray(entries)).toBe(true);
      expect(entries.some((e) => (e.path ?? '').includes('mcp-test.txt'))).toBe(true);

      // Delete — tool returns `{deleted: <count>}` not `{ok}`
      const del = await mcp.client.callTool({
        name: 'bunny.storage_rm',
        arguments: { target: `${storageZoneName}/mcp-test.txt` },
      });
      const delRes = unwrapJson<{ deleted: number }>(
        del as { content?: Array<{ type: string; text?: string }> },
      );
      expect(delRes.deleted).toBeGreaterThanOrEqual(1);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Write tools with cleanup — round-trip create/delete through MCP.
  // -----------------------------------------------------------------------

  it('bunny.storage_zone_create + bunny.storage_zone_delete (by name) round-trip', async () => {
    const name = uniqueId('mcp-zc');
    const created = await mcp.client.callTool({
      name: 'bunny.storage_zone_create',
      arguments: { name },
    });
    const zone = unwrapJson<{ Id: number; Name: string }>(
      created as { content?: Array<{ type: string; text?: string }> },
    );
    expect(zone.Name).toBe(name);
    expect(zone).not.toHaveProperty('Password');
    expect(zone).not.toHaveProperty('ReadOnlyPassword');
    register('storage-zone', zone.Id, name);

    const deleted = await mcp.client.callTool({
      name: 'bunny.storage_zone_delete',
      arguments: { zone: name },
    });
    const delRes = unwrapJson<{ ok: boolean }>(
      deleted as { content?: Array<{ type: string; text?: string }> },
    );
    expect(delRes.ok).toBe(true);
  });

  it('bunny.dns_record_add + bunny.dns_record_delete round-trip', async () => {
    const set = await mcp.client.callTool({
      name: 'bunny.dns_record_add',
      arguments: {
        zone: dnsZoneId,
        type: 'TXT',
        name: 'mcp-e2e',
        value: 'smoke',
        ttl: 300,
      },
    });
    const record = unwrapJson<{ Id: number; Type: number; Value: string }>(
      set as { content?: Array<{ type: string; text?: string }> },
    );
    expect(record.Value).toBe('smoke');

    const deleted = await mcp.client.callTool({
      name: 'bunny.dns_record_delete',
      arguments: { zone: dnsZoneId, recordId: record.Id },
    });
    const delRes = unwrapJson<{ ok: boolean }>(
      deleted as { content?: Array<{ type: string; text?: string }> },
    );
    expect(delRes.ok).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Purge — write op that returns no payload beyond an ok envelope. Bunny
  // accepts purge requests for any URL on a zone they own, even fictional
  // paths; no setup needed beyond a known CDN hostname.
  // -----------------------------------------------------------------------

  it('bunny.purge accepts a CDN URL', async () => {
    const r = await mcp.client.callTool({
      name: 'bunny.purge',
      arguments: { urls: [KNOWN_PURGE_URL] },
    });
    const res = unwrapJson<{ ok: number; failed: unknown[] }>(
      r as { content?: Array<{ type: string; text?: string }> },
    );
    expect(res.ok).toBe(1);
    expect(res.failed).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Pull-zone hostname round-trip — exercises the rc.25 list/add/remove
  // tools individually. Gated on BUNNY_E2E_DOMAIN + BUNNY_E2E_DNS_ZONE_ID
  // (the latter auto-resolved from the former in beforeAll).
  //
  // Bunny's addHostname API enforces a DNS-pointing check ("The domain
  // ... is not pointing to our servers") and rejects link attempts for
  // hostnames that don't resolve to Bunny's CDN. The MCP tool has no
  // link-only mode that skips this — running these tests needs a
  // pre-existing DNS record pointing at the pull zone, which means
  // DNS_ZONE_ID. The `domain_connect` test does this atomically; this
  // single-tool test currently can't (would need either a new MCP flag
  // or pre-test DNS setup). For now, gating prevents CI noise.
  // -----------------------------------------------------------------------

  // Runtime skip (not it.skipIf) because BUNNY_E2E_DNS_ZONE_ID is auto-
  // resolved during beforeAll. it.skipIf evaluates at test-collection time
  // — before beforeAll runs — so the resolved value isn't visible yet.
  // ctx.skip() at the top of the test body honors the post-beforeAll env.
  function skipIfNoDomain(ctx: { skip: () => void }): boolean {
    if (!process.env['BUNNY_E2E_DOMAIN'] || !process.env['BUNNY_E2E_DNS_ZONE_ID']) {
      ctx.skip();
      return true;
    }
    return false;
  }
  it('bunny.cdn_hostname_{list,add,remove} round-trip', async (ctx) => {
    if (skipIfNoDomain(ctx)) return;
    const e2eDomainEnv = process.env['BUNNY_E2E_DOMAIN']!;
    const host = `${suitePrefix()}-mcp-host.${e2eDomainEnv}`;

    const initial = unwrapJson<{ hostnames: string[] }>(
      (await mcp.client.callTool({
        name: 'bunny.cdn_hostname_list',
        arguments: { pullZone: pullZoneId },
      })) as { content?: Array<{ type: string; text?: string }> },
    );
    expect(Array.isArray(initial.hostnames)).toBe(true);
    expect(initial.hostnames).not.toContain(host);

    // rc.53: every hostname-mutating MCP tool returns
    // { ok, hostname, hostnames, ...metadata }. Caller can verify
    // post-state in one read — no follow-up list call needed.
    const added = unwrapJson<{ ok: boolean; hostname: string; hostnames: string[] }>(
      (await mcp.client.callTool({
        name: 'bunny.cdn_hostname_add',
        arguments: { pullZone: pullZoneId, hostname: host },
      })) as { content?: Array<{ type: string; text?: string }> },
    );
    expect(added.ok).toBe(true);
    expect(added.hostname).toBe(host);
    expect(added.hostnames).toContain(host);

    // Idempotency: re-add must not 4xx, and the post-state list must
    // still contain exactly one entry for this host.
    const reAdded = unwrapJson<{ ok: boolean; hostnames: string[] }>(
      (await mcp.client.callTool({
        name: 'bunny.cdn_hostname_add',
        arguments: { pullZone: pullZoneId, hostname: host },
      })) as { content?: Array<{ type: string; text?: string }> },
    );
    expect(reAdded.ok).toBe(true);
    expect(reAdded.hostnames.filter((h) => h === host).length).toBe(1);

    const removed = unwrapJson<{ ok: boolean; hostname: string; hostnames: string[] }>(
      (await mcp.client.callTool({
        name: 'bunny.cdn_hostname_remove',
        arguments: { pullZone: pullZoneId, hostname: host },
      })) as { content?: Array<{ type: string; text?: string }> },
    );
    expect(removed.ok).toBe(true);
    expect(removed.hostname).toBe(host);
    expect(removed.hostnames).not.toContain(host);
  });

  // -----------------------------------------------------------------------
  // enable_ssl — gated on BUNNY_E2E_DOMAIN because Let's Encrypt cert
  // provisioning needs a real domain with Bunny NS authoritative (DNS-01).
  // Set BUNNY_E2E_DOMAIN=<domain you own on Bunny DNS> to opt in. Skipped
  // otherwise — including in CI nightly unless the var is configured.
  // ~30-90s wall-clock for cert provisioning.
  // -----------------------------------------------------------------------

  // Same DNS-pointing constraint as the round-trip above: standalone
  // hostname add can't pass without a pre-existing DNS record. Gated on
  // both BUNNY_E2E_DOMAIN + DNS_ZONE_ID uniformly. Runtime skip — see
  // skipIfNoDomain comment above.
  it(
    'bunny.cdn_hostname_add provisions cert via DNS-01 in one call (rc.37)',
    async (ctx) => {
      if (skipIfNoDomain(ctx)) return;
      const host = `${suitePrefix()}-cert.${process.env['BUNNY_E2E_DOMAIN']}`;
      // rc.37: `add` is now the idempotent state-setter — it links + provisions
      // cert + enables ForceSSL in one call. Replaces the rc.26-36 enable_ssl tool.
      try {
        const result = unwrapJson<{ ok: boolean; hasCertificate?: boolean; forceSslSet?: boolean }>(
          (await mcp.client.callTool({
            name: 'bunny.cdn_hostname_add',
            arguments: { pullZone: pullZoneId, hostname: host },
          })) as { content?: Array<{ type: string; text?: string }> },
        );
        expect(result.ok).toBe(true);
        expect(result.hasCertificate).toBe(true);
        // ForceSSL flipped on by default (forceSslSet=true) OR was already true (undefined).
        // Either is acceptable; the assertion is the cert provisioned.
      } finally {
        await mcp.client.callTool({
          name: 'bunny.cdn_hostname_remove',
          arguments: { pullZone: pullZoneId, hostname: host },
        });
      }
    },
    120_000,
  );

  // -----------------------------------------------------------------------
  // Negative input — proves the zod schema validates and the MCP error
  // envelope is well-formed (not a crash).
  // -----------------------------------------------------------------------

  it('bunny.cdn_hostname_list returns isError envelope on missing required argument', async () => {
    // MCP encodes tool errors as `{isError: true, content: [{type:'text', text:'...'}]}`
    // rather than throwing. Test the protocol-level shape, not exception flow.
    const result = await mcp.client.callTool({
      name: 'bunny.cdn_hostname_list',
      arguments: {},
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
    const text = (result as { content?: Array<{ type: string; text?: string }> }).content?.[0]
      ?.text ?? '';
    expect(text).toMatch(/pullZone|required|invalid/i);
  });

  // -----------------------------------------------------------------------
  // bunny.deploy and bunny.init are skipped here — deploy needs a full
  // bunny.json + tmpdir setup that overlaps with deploy.e2e.ts, and init
  // is interactive in spirit (the non-interactive form is exercised by
  // unit tests in test/core/init.test.ts). Re-add if the wrapper layer
  // ever gets new logic worth covering.
  // -----------------------------------------------------------------------
  // -----------------------------------------------------------------------
  // domain_connect — atomic Connect Domain. Gated on BUNNY_E2E_DOMAIN
  // (same reason as enable_ssl: real domain needed for DNS-01). DNS zone
  // id is auto-resolved from the domain in beforeAll. Cleans up the
  // hostname + DNS record after the test.
  // -----------------------------------------------------------------------
  it(
    'bunny.domain_connect provisions hostname + cert + DNS record atomically',
    async (ctx) => {
      if (skipIfNoDomain(ctx)) return;
      const fqdn = `${suitePrefix()}-domain.${process.env['BUNNY_E2E_DOMAIN']}`;
      const dnsZoneId = Number.parseInt(process.env['BUNNY_E2E_DNS_ZONE_ID']!, 10);
      const result = unwrapJson<{
        ok: boolean;
        hostname: string;
        hostnames: string[];
        hasCertificate: boolean;
        dnsRecordId?: number;
      }>(
        (await mcp.client.callTool({
          name: 'bunny.domain_connect',
          arguments: {
            pullZone: pullZoneId,
            hostname: fqdn,
            dnsZone: dnsZoneId,
            recordName: fqdn.split('.')[0],
          },
        })) as { content?: Array<{ type: string; text?: string }> },
      );
      expect(result.ok).toBe(true);
      expect(result.hostname).toBe(fqdn);
      expect(result.hostnames).toContain(fqdn);
      expect(result.hasCertificate).toBe(true);
      expect(result.dnsRecordId).toBeGreaterThan(0);

      // Cleanup: delete DNS record then remove hostname so re-runs are clean.
      try {
        if (result.dnsRecordId) {
          await mcp.client.callTool({
            name: 'bunny.dns_record_delete',
            arguments: { zone: dnsZoneId, recordId: result.dnsRecordId },
          });
        }
        await mcp.client.callTool({
          name: 'bunny.cdn_hostname_remove',
          arguments: { pullZone: pullZoneId, hostname: fqdn },
        });
      } catch {
        // best-effort cleanup
      }
    },
    120_000,
  );

  it.skip('bunny.deploy (covered indirectly by deploy.e2e.ts via CLI)', () => {});
  it.skip('bunny.init (interactive shape; non-interactive covered by unit)', () => {});
});

// `KNOWN_PURGE_URL` reserved for future purge variants.
void 0;
