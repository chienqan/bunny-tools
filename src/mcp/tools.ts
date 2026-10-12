// MCP tools - high-level surface mirroring the CLI tree (storage_*, cdn_*,
// dns_*, ...) plus an escape hatch. Each calls into src/core/* directly (no CLI
// plumbing here). Inputs validated with zod. Resource refs accept a name /
// domain or a numeric id, same as the CLI.

import { z } from 'zod';
import { spawn } from 'node:child_process';
import { runDeploy } from '../core/deploy.js';
import { resolvePurgeTargets, runPurgeTargets } from '../core/purge.js';
import { listScopes } from '../core/auth.js';
import { FEATURES, runInit } from '../core/init.js';
import { listPath, listZones, deletePath, downloadFile, uploadFile, parseStorageTarget } from '../core/storage-ops.js';
import {
  listStorageZones,
  createStorageZone,
  deleteStorageZone,
  listPullZones,
  getPullZone,
  createPullZone,
  deletePullZone,
  addPullZoneHostname,
  removePullZoneHostname,
  listPullZoneHostnames,
  enablePullZoneSSL,
  setHostnameForceSSL,
  compactPullZone,
} from '../core/zones.js';
import {
  listZones as listDnsZones,
  listRecords,
  addRecord,
  deleteRecord,
  summarizeDnsZone,
  compactDnsRecord,
} from '../core/dns.js';
import { getAccountSummary } from '../core/whoami.js';
import { resolveDnsZoneId, resolvePullZoneId, resolveStorageZoneId } from '../core/resolve.js';
import { loadBunnyJson } from '../config/bunny-json.js';
import { registry } from '../manifest/registry.js';
import { renderRegistryHelpJson } from '../manifest/render-help.js';
import { maskCredential } from '../config/credential-resolver.js';
import { resolveCredential } from '../config/credential-resolver.js';

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  /** Returns a JSON-serializable result. */
  run: (args: unknown) => Promise<unknown>;
};

// Name, domain, or numeric id.
const Ref = z.union([z.string().min(1), z.number().int().positive()]);
const RECORD_TYPES = [
  'A', 'AAAA', 'CNAME', 'TXT', 'MX', 'REDIRECT', 'PULLZONE',
  'SRV', 'CAA', 'PTR', 'SCRIPT', 'NS',
] as const;

const PurgeInput = z.object({
  urls: z.array(z.string()).optional(),
  pullZone: Ref.optional(),
  tag: z.string().optional(),
});
const StorageLsInput = z.object({ target: z.string().optional(), recursive: z.boolean().optional() });
const StorageUploadInput = z.object({ local: z.string(), target: z.string() });
const StorageDownloadInput = z.object({ target: z.string(), local: z.string().optional() });
// `full: true` returns Bunny's raw objects; the default is a compact shape that
// keeps agent context small.
const FullFlag = z.boolean().optional();
const CdnListInput = z.object({ full: FullFlag });
const StorageRmInput = z.object({ target: z.string(), recursive: z.boolean().optional() });
const StorageZoneCreateInput = z.object({ name: z.string(), region: z.string().optional() });
const StorageZoneRefInput = z.object({ zone: Ref });
const CdnCreateInput = z.object({ name: z.string(), origin: z.string().url() });
const PullZoneRefInput = z.object({ pullZone: Ref });
const HostnameRefInput = z.object({ pullZone: Ref, hostname: z.string().min(1) });
const HostnameAddInput = HostnameRefInput.extend({
  noForceSSL: z.boolean().optional(),
  timeoutMs: z.number().int().positive().max(300_000).optional(),
});
const DomainConnectInput = z.object({
  pullZone: Ref,
  hostname: z.string().min(1),
  dnsZone: Ref.optional(),
  recordName: z.string().optional(),
  noForceSSL: z.boolean().optional(),
});
const DnsListInput = z.object({ zone: Ref.optional(), full: FullFlag });
const DnsRecordAddInput = z.object({
  zone: Ref,
  type: z.enum(RECORD_TYPES),
  name: z.string(),
  // Optional for PULLZONE when pullZone is set; otherwise required.
  value: z.string().optional(),
  ttl: z.number().int().positive().optional(),
  priority: z.number().int().nonnegative().optional(),
  weight: z.number().int().nonnegative().optional(),
  port: z.number().int().positive().optional(),
  flags: z.number().int().nonnegative().optional(),
  tag: z.string().optional(),
  linkName: z.string().optional(),
  pullZone: Ref.optional(),
});
const DnsRecordDeleteInput = z.object({ zone: Ref, recordId: z.number().int().positive() });

export const TOOLS: ToolDef[] = [
  {
    name: 'bunny.deploy',
    description:
      '**Recommended for CI/CD.** End-to-end deploy: walks publicDir, diffs vs storage zone, uploads changed files with proper MIME types in parallel, optionally purges CDN. Replaces custom upload scripts. Returns counts and durations.',
    inputSchema: z.object({
      dryRun: z.boolean().optional(),
      deleteOrphans: z.boolean().optional(),
      concurrency: z.number().int().positive().max(64).optional(),
      purge: z.string().optional(),
    }),
    run: async (raw) => {
      const args = z
        .object({
          dryRun: z.boolean().optional(),
          deleteOrphans: z.boolean().optional(),
          concurrency: z.number().int().positive().max(64).optional(),
          purge: z.string().optional(),
        })
        .parse(raw);
      const { config } = await loadBunnyJson();
      return runDeploy({
        config,
        cwd: process.cwd(),
        ...(args.dryRun ? { dryRun: true } : {}),
        ...(args.deleteOrphans ? { deleteOrphans: true } : {}),
        ...(args.concurrency ? { concurrency: args.concurrency } : {}),
        ...(args.purge ? { purgeOverride: args.purge } : {}),
      });
    },
  },
  {
    name: 'bunny.purge',
    description:
      'Purge CDN cache. Pass `urls` (full URLs), and/or `pullZone` (name or id) to purge a whole zone, optionally narrowed by `tag` (Cache-Tag). Returns { ok, failed }.',
    inputSchema: PurgeInput,
    run: async (raw) => {
      const args = PurgeInput.parse(raw);
      const targets = await resolvePurgeTargets(args);
      if (targets.length === 0) throw new Error('Pass `urls` and/or `pullZone`.');
      return runPurgeTargets(targets);
    },
  },
  {
    name: 'bunny.storage_ls',
    description:
      'List storage. Omit `target` to list all storage zones; pass "<zone>" or "<zone>/<path>" to list files. Only the account API key is needed (zone passwords are fetched automatically).',
    inputSchema: StorageLsInput,
    run: async (raw) => {
      const { target, recursive } = StorageLsInput.parse(raw);
      if (!target) return listZones();
      return listPath(parseStorageTarget(target), recursive ? { recursive: true } : {});
    },
  },
  {
    name: 'bunny.storage_upload',
    description: 'Upload a local file to "<zone>/<path>". A trailing slash keeps the local file name. Returns { zone, path }.',
    inputSchema: StorageUploadInput,
    run: async (raw) => {
      const args = StorageUploadInput.parse(raw);
      const target = parseStorageTarget(args.target);
      const path = await uploadFile(args.local, target);
      return { zone: target.zone, path };
    },
  },
  {
    name: 'bunny.storage_download',
    description:
      'Download a file at "<zone>/<path>" to a local path (default: the remote file name in the working directory). Returns { zone, path, local }.',
    inputSchema: StorageDownloadInput,
    run: async (raw) => {
      const args = StorageDownloadInput.parse(raw);
      const target = parseStorageTarget(args.target);
      const local = await downloadFile(target, args.local);
      return { zone: target.zone, path: target.path, local };
    },
  },
  {
    name: 'bunny.storage_rm',
    description: 'Delete a file at "<zone>/<path>", or a whole directory with recursive=true. Zone roots are refused. Returns { deleted }.',
    inputSchema: StorageRmInput,
    run: async (raw) => {
      const args = StorageRmInput.parse(raw);
      const deleted = await deletePath(parseStorageTarget(args.target), args.recursive ? { recursive: true } : {});
      return { deleted };
    },
  },
  {
    name: 'bunny.storage_zone_list',
    description: 'List storage zones with id, region, file count, size and replication (passwords stripped).',
    inputSchema: z.object({}),
    run: async () => listStorageZones(),
  },
  {
    name: 'bunny.storage_zone_create',
    description: 'Create a storage zone. `region` is a code like ny, la, sg.',
    inputSchema: StorageZoneCreateInput,
    run: async (raw) => {
      const args = StorageZoneCreateInput.parse(raw);
      return createStorageZone({ name: args.name, ...(args.region ? { region: args.region.toUpperCase() } : {}) });
    },
  },
  {
    name: 'bunny.storage_zone_delete',
    description: 'Delete a storage zone (name or id) and all its files.',
    inputSchema: StorageZoneRefInput,
    run: async (raw) => {
      const { zone } = StorageZoneRefInput.parse(raw);
      const id = await resolveStorageZoneId(zone);
      await deleteStorageZone(id);
      return { ok: true, id };
    },
  },
  {
    name: 'bunny.cdn_list',
    description:
      'List pull zones (CDN): id, name, origin, enabled, hostnames with SSL state. Pass `full: true` for Bunny\'s raw pull zone objects.',
    inputSchema: CdnListInput,
    run: async (raw) => {
      const { full } = CdnListInput.parse(raw);
      const zones = await listPullZones();
      return full ? zones : zones.map(compactPullZone);
    },
  },
  {
    name: 'bunny.cdn_create',
    description: 'Create a pull zone in front of an origin URL.',
    inputSchema: CdnCreateInput,
    run: async (raw) => {
      const args = CdnCreateInput.parse(raw);
      return createPullZone(args.name, args.origin);
    },
  },
  {
    name: 'bunny.cdn_delete',
    description: 'Delete a pull zone (name or id).',
    inputSchema: PullZoneRefInput,
    run: async (raw) => {
      const { pullZone } = PullZoneRefInput.parse(raw);
      const id = await resolvePullZoneId(pullZone);
      await deletePullZone(id);
      return { ok: true, id };
    },
  },
  {
    name: 'bunny.cdn_hostname_list',
    description: 'List custom hostnames linked to a pull zone (name or id).',
    inputSchema: PullZoneRefInput,
    run: async (raw) => {
      const { pullZone } = PullZoneRefInput.parse(raw);
      return { hostnames: await listPullZoneHostnames(await resolvePullZoneId(pullZone)) };
    },
  },
  {
    name: 'bunny.cdn_hostname_add',
    description:
      'Idempotent state-setter: link hostname + provision Let\'s Encrypt cert + enable ForceSSL (HTTP→HTTPS redirect). Pass `noForceSSL=true` to provision cert without the redirect (re-running with this flag flips ForceSSL OFF if previously on). Returns { ok, hostname, hostnames, hasCertificate, forceSslSet? }.',
    inputSchema: HostnameAddInput,
    run: async (raw) => {
      const { pullZone, hostname, noForceSSL, timeoutMs } = HostnameAddInput.parse(raw);
      const pullZoneId = await resolvePullZoneId(pullZone);

      // Idempotent linking - only POST addHostname when not already present.
      const existing = await listPullZoneHostnames(pullZoneId);
      if (!existing.includes(hostname)) {
        await addPullZoneHostname(pullZoneId, hostname);
      }

      const sslResult = await enablePullZoneSSL(pullZoneId, hostname, {
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        ...(noForceSSL ? { noForceSSL: true } : {}),
      });
      // State assertion when noForceSSL: ensure ForceSSL=false even if a prior
      // run left it true. enablePullZoneSSL with noForceSSL skips the
      // auto-flip-on but doesn't actively turn it off.
      if (noForceSSL) {
        await setHostnameForceSSL(pullZoneId, hostname, false);
      }
      // Every hostname-mutating tool returns { ok, hostname, hostnames, ... }
      // so agents get post-state in one call.
      const hostnames = await listPullZoneHostnames(pullZoneId);
      return {
        ok: true,
        hostname,
        hostnames,
        hasCertificate: sslResult.hasCertificate,
        ...(sslResult.forceSslSet ? { forceSslSet: true } : {}),
        ...(noForceSSL ? { forceSslSet: false } : {}),
      };
    },
  },
  {
    name: 'bunny.cdn_hostname_remove',
    description: 'Unlink a custom hostname from a pull zone (name or id). Returns { ok, hostname, hostnames }.',
    inputSchema: HostnameRefInput,
    run: async (raw) => {
      const { pullZone, hostname } = HostnameRefInput.parse(raw);
      const hostnames = await removePullZoneHostname(await resolvePullZoneId(pullZone), hostname);
      return { ok: true, hostname, hostnames };
    },
  },
  {
    name: 'bunny.domain_connect',
    description:
      'Atomic Connect Domain: link hostname to a pull zone (name or id), provision Let\'s Encrypt cert (waits up to 90s), optionally create the apex PULLZONE DNS record. Mirrors the Bunny dashboard "Connect Domain" button. Idempotent - safe to re-run. Pass `dnsZone` (domain or id) to also create the DNS record. Returns { ok, hostname, hostnames, hasCertificate, dnsRecordId?, certWaitedMs }.',
    inputSchema: DomainConnectInput,
    run: async (raw) => {
      const args = DomainConnectInput.parse(raw);
      const pullZoneId = await resolvePullZoneId(args.pullZone);
      const dnsZoneId = args.dnsZone !== undefined ? await resolveDnsZoneId(args.dnsZone) : undefined;
      const { connectDomain } = await import('../core/domain.js');
      const result = await connectDomain(pullZoneId, args.hostname, {
        ...(dnsZoneId !== undefined ? { dnsZoneId } : {}),
        ...(args.recordName !== undefined ? { recordName: args.recordName } : {}),
        ...(args.noForceSSL ? { noForceSSL: true } : {}),
      });
      // Same shape as the hostname tools: the hostname acted on + post-state list.
      const hostnames = await listPullZoneHostnames(pullZoneId);
      return {
        ok: result.ok,
        hostname: args.hostname,
        hostnames,
        hasCertificate: result.hasCertificate,
        ...(result.dnsRecordId !== undefined ? { dnsRecordId: result.dnsRecordId } : {}),
        certWaitedMs: result.certWaitedMs,
      };
    },
  },
  {
    name: 'bunny.dns_list',
    description:
      'Without `zone`: DNS zones as { Id, Domain, records }. With `zone` (domain or id): that zone\'s records as { Id, type, name, value, ttl, ... } with type names (A, CNAME, PULLZONE...). Pass `full: true` for Bunny\'s raw objects.',
    inputSchema: DnsListInput,
    run: async (raw) => {
      const { zone, full } = DnsListInput.parse(raw);
      if (zone === undefined) {
        const zones = await listDnsZones();
        return full ? zones : zones.map(summarizeDnsZone);
      }
      const records = await listRecords(await resolveDnsZoneId(zone));
      return full ? records : records.map(compactDnsRecord);
    },
  },
  {
    name: 'bunny.dns_record_add',
    description:
      'Add a DNS record to `zone` (domain or id). Standard types (A/AAAA/CNAME/TXT/MX/SRV/CAA/NS) plus Bunny routing types (REDIRECT/PULLZONE/PTR/SCRIPT). For PULLZONE: pass `pullZone` (name or id) and value+linkName are derived - mirrors the CLI `--pull-zone` convenience. SCRIPT still requires linkName.',
    inputSchema: DnsRecordAddInput,
    run: async (raw) => {
      const parsed = DnsRecordAddInput.parse(raw);
      const { zone, pullZone, ...rest } = parsed;

      // PULLZONE convenience: derive Value (PZ name) and LinkName (PZ id).
      // Explicit value/linkName still win.
      let resolved: typeof rest = rest;
      if (parsed.type === 'PULLZONE' && pullZone !== undefined) {
        const pz = await getPullZone(await resolvePullZoneId(pullZone));
        resolved = {
          ...rest,
          value: rest.value ?? pz.Name,
          linkName: rest.linkName ?? String(pz.Id),
        };
      }

      if (!resolved.value) {
        throw new Error(
          parsed.type === 'PULLZONE'
            ? 'PULLZONE record requires either `pullZone` (recommended) or both `value` and `linkName`.'
            : 'value is required',
        );
      }
      return addRecord(await resolveDnsZoneId(zone), resolved);
    },
  },
  {
    name: 'bunny.dns_record_delete',
    description: 'Delete a DNS record by zone (domain or id) + record id.',
    inputSchema: DnsRecordDeleteInput,
    run: async (raw) => {
      const { zone, recordId } = DnsRecordDeleteInput.parse(raw);
      await deleteRecord(await resolveDnsZoneId(zone), recordId);
      return { ok: true };
    },
  },
  {
    name: 'bunny.whoami',
    description:
      'Account context: stored credential scopes (masked) and how many storage zones, pull zones and DNS zones the account key reaches. Use first to check that credentials work.',
    inputSchema: z.object({}),
    run: async () => getAccountSummary(),
  },
  {
    name: 'bunny.manifest',
    description: 'Returns the canonical bunny-tools command registry as JSON. Use this to discover the full CLI surface.',
    inputSchema: z.object({}),
    run: async () => renderRegistryHelpJson(registry),
  },
  {
    name: 'bunny.init',
    description:
      'Initialize a bunny.json + store credentials in one call. Non-interactive shape. Use this to bootstrap a project. Returns the result with bunnyJsonPath, storedScopes, features.',
    inputSchema: z.object({
      features: z.array(z.enum(FEATURES)).min(1),
      apiKey: z.string().optional(),
      publicDir: z.string().optional(),
      storageZone: z.string().optional(),
      storagePassword: z.string().optional(),
      region: z.string().optional(),
      pullZoneId: z.number().int().optional(),
      purge: z.string().optional(),
      streamLibraryId: z.string().optional(),
      streamKey: z.string().optional(),
      cwd: z.string().optional(),
      force: z.boolean().optional(),
    }),
    run: async (raw) => {
      const args = z
        .object({
          features: z.array(z.enum(FEATURES)).min(1),
          apiKey: z.string().optional(),
          publicDir: z.string().optional(),
          storageZone: z.string().optional(),
          storagePassword: z.string().optional(),
          region: z.string().optional(),
          pullZoneId: z.number().int().optional(),
          purge: z.string().optional(),
          streamLibraryId: z.string().optional(),
          streamKey: z.string().optional(),
          cwd: z.string().optional(),
          force: z.boolean().optional(),
        })
        .parse(raw);
      const noopAsk = async () => {
        throw new Error('bunny.init MCP tool is non-interactive; provide all required fields.');
      };
      const { cwd, force, ...input } = args;
      return runInit(
        input,
        {
          ask: noopAsk,
          pick: noopAsk,
          multiselect: async () => args.features,
          confirm: async () => false,
        },
        { interactive: false, ...(cwd ? { cwd } : {}), ...(force ? { force: true } : {}) },
      );
    },
  },
  {
    name: 'bunny.run',
    description:
      'Escape hatch: run any bunny-tools CLI invocation from the same working directory. Use when no dedicated MCP tool exists. Returns stdout, stderr, exitCode.',
    inputSchema: z.object({
      args: z.array(z.string()).min(1),
      cwd: z.string().optional(),
      timeoutMs: z.number().int().positive().max(300_000).optional(),
    }),
    run: async (raw) => {
      const { args, cwd, timeoutMs } = z
        .object({
          args: z.array(z.string()).min(1),
          cwd: z.string().optional(),
          timeoutMs: z.number().int().positive().max(300_000).optional(),
        })
        .parse(raw);
      // Reject `mcp` to prevent recursive boot.
      if (args[0] === 'mcp') throw new Error('Refusing to invoke `bunny mcp` via bunny.run.');
      // Re-spawn the SAME entry point that's running this MCP server. In
      // production builds that's `node dist/cli.js`; in dev (tsx) it's
      // `node --import tsx src/cli.ts`. process.execArgv carries the loader
      // flags so the child can execute a .ts entry too - without forwarding
      // execArgv, the child would crash when argv[1] is a TypeScript file.
      const argv1 = process.argv[1] ?? 'bunny';
      const childArgs = [...process.execArgv, argv1, ...args];
      return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, childArgs, {
          cwd: cwd ?? process.cwd(),
          env: process.env,
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => (stdout += d.toString()));
        child.stderr.on('data', (d) => (stderr += d.toString()));
        const timer = timeoutMs
          ? setTimeout(() => {
              child.kill('SIGTERM');
              reject(new Error(`bunny.run timed out after ${timeoutMs}ms`));
            }, timeoutMs)
          : null;
        child.on('exit', (code) => {
          if (timer) clearTimeout(timer);
          resolve({ exitCode: code ?? 0, stdout, stderr });
        });
        child.on('error', reject);
      });
    },
  },
];

// Resource: masked current credentials view. Exposed for AI introspection.
export async function readConfigResource(): Promise<unknown> {
  const scopes = await listScopes();
  // Belt-and-suspenders: extra masking pass even though listScopes already masks.
  return scopes.map((s) => ({ scope: s.scope, value: maskCredential(s.masked) }));
}

// Re-export for tests:
export const _internal = { resolveCredential };
