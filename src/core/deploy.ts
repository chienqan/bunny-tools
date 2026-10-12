// core/deploy - orchestrates the full deploy pipeline. UI-free; emits progress events.

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { contentTypeFor } from '../util/content-type.js';
import type { BunnyJson } from '../config/bunny-json.js';
import { resolveCredential } from '../config/credential-resolver.js';
import { createAccountClient, regionCodeToSubdomain } from '../api/account.js';
import { createStorageClient } from '../api/storage.js';
import { resolveScopedCredential } from './scoped-key-resolver.js';
import { walkPublicDir } from '../deploy/walk.js';
import { diffFiles } from '../deploy/diff.js';
import { buildRemoteMap } from '../deploy/remote-list.js';
import { runPool, summarizeResults } from '../deploy/upload-queue.js';
import { loadState, saveState, STATE_FILENAME } from '../deploy/state.js';
import { getActiveAliasOverlay } from './aliases.js';
import { maybeMigrateIgnoreDefaults } from './ignore-migration.js';
import { syncEdgeRulesForPullZone } from './edge-rules-sync.js';

// Files over this threshold trigger a non-blocking warning at upload time.
// Captures the "I accidentally committed a 50MB binary" case without gating
// the deploy. KISS - no flag, no config knob until someone asks.
const LARGE_FILE_THRESHOLD_BYTES = 5 * 1024 * 1024;

// Extensions where Bunny's edge MIME table doesn't match modern browser
// expectations. We DO send the correct Content-Type at upload (mime-types
// gives us `text/javascript; charset=utf-8` for `.mjs`), but Bunny's edge
// has its own MIME table that overrides upload metadata for unknown types
// - `.mjs` ends up served as `application/octet-stream`, breaking ES
// modules. Surface a one-shot warning per deploy with the bunny.json fix.
const KNOWN_BROKEN_EDGE_MIME = new Set(['.mjs', '.wasm', '.webmanifest']);

export type DeployOptions = {
  config: BunnyJson;
  configFilePath?: string;
  cwd: string;
  dryRun?: boolean;
  deleteOrphans?: boolean;
  concurrency?: number;
  /** Override purge config from bunny.json: 'tag:<n>' | 'all' | 'none' | 'paths'. */
  purgeOverride?: string;
  /** When true, emits 'mime' events per upload for detailed MIME observability. */
  verbose?: boolean;
  /** Progress events. */
  onEvent?: (e: DeployEvent) => void;
};

export type DeployEvent =
  | { type: 'phase'; phase: string; message?: string }
  | { type: 'walk'; total: number; warnings: string[] }
  | {
      type: 'diff';
      new: number;
      changed: number;
      unchanged: number;
      orphan: number;
      orphanPaths: string[];
    }
  | { type: 'upload-progress'; completed: number; total: number; path: string }
  | { type: 'delete-progress'; completed: number; total: number; path: string }
  | { type: 'purge'; targets: string[] }
  | { type: 'warn'; message: string }
  | { type: 'mime'; path: string; contentType: string; size: number }
  | { type: 'large-file'; path: string; size: number }
  | { type: 'migrate-ignores'; from: number; to: number }
  | { type: 'auto-spawned-pz'; recordType: string; pullZoneId: number }
  | { type: 'edge-rules-sync'; pullZoneId: number; added: number; updated: number; deleted: number };

export type DeployResult = {
  zone: string;
  region: string;
  uploaded: number;
  deleted: number;
  unchanged: number;
  failed: Array<{ path: string; error: string }>;
  purged: number;
  durationMs: number;
};

export async function runDeploy(opts: DeployOptions): Promise<DeployResult> {
  const t0 = Date.now();
  const ev = opts.onEvent ?? (() => {});

  // 0. One-shot ignore migration. Only rewrites bunny.json when its
  // `deploy.ignore` is byte-equal to the rc.32 legacy default - meaning
  // the user never customized. Best-effort: failure (read-only FS, etc.)
  // is logged but doesn't block the deploy.
  if (opts.configFilePath && !opts.dryRun) {
    const migrated = await maybeMigrateIgnoreDefaults(opts.configFilePath, opts.config);
    if (migrated) {
      ev({ type: 'migrate-ignores', from: migrated.from, to: migrated.to });
    }
  }

  // 1. Apply alias overlay (alias's storageZone wins if present).
  const alias = await getActiveAliasOverlay(opts.cwd);
  const zone = alias?.storageZone ?? opts.config.deploy.storageZone;
  const concurrency = opts.concurrency ?? opts.config.deploy.concurrency ?? 8;

  ev({ type: 'phase', phase: 'resolve-region' });
  // 2. Resolve region: explicit override > alias > bunny.json > account API lookup.
  const acct = createAccountClient({ resolveCredential: (s) => resolveCredential(s) });
  const explicit = alias?.region ?? opts.config.deploy.region;
  let region = explicit ?? '';
  if (!explicit) {
    const meta = await acct.getStorageZoneByName(zone);
    if (!meta) throw new Error(`Storage zone "${zone}" not found on this account.`);
    region = regionCodeToSubdomain(meta.Region);
  }

  // 3. Walk public dir.
  ev({ type: 'phase', phase: 'walk' });
  const warnings: string[] = [];
  const local = await walkPublicDir({
    publicDir: join(opts.cwd, opts.config.deploy.publicDir),
    ignorePatterns: opts.config.deploy.ignore,
    onWarn: (m) => warnings.push(m),
  });
  for (const w of warnings) ev({ type: 'warn', message: w });
  ev({ type: 'walk', total: local.length, warnings });

  // 4. Load state cache + remote map.
  ev({ type: 'phase', phase: 'remote-list' });
  // Scoped resolver: falls back to the zone password fetched with the account key.
  const storageClient = createStorageClient({ resolveCredential: (s) => resolveScopedCredential(s) });
  const stateFile = join(opts.cwd, STATE_FILENAME);
  const cachedState = await loadState(stateFile);
  const remote = await buildRemoteMap(storageClient, zone, region, '/');

  // 5. Diff.
  ev({ type: 'phase', phase: 'diff' });
  const diff = await diffFiles({ zone, local, remote, cachedState });
  ev({
    type: 'diff',
    new: diff.byClass.new.length,
    changed: diff.byClass.changed.length,
    unchanged: diff.byClass.unchanged.length,
    orphan: diff.byClass.orphan.length,
    orphanPaths: diff.byClass.orphan.map((o) => o.path),
  });

  if (opts.dryRun) {
    return {
      zone,
      region,
      uploaded: 0,
      deleted: 0,
      unchanged: diff.byClass.unchanged.length,
      failed: [],
      purged: 0,
      durationMs: Date.now() - t0,
    };
  }

  // 6. Upload pool.
  ev({ type: 'phase', phase: 'upload', message: `concurrency=${concurrency}` });
  const toUpload = [...diff.byClass.new, ...diff.byClass.changed];
  const mimeOverrides = opts.config.deploy.mimeTypes;

  // Pre-scan for files whose extensions Bunny's edge doesn't natively
  // recognize. Emit ONE warning per extension with the bunny.json fix -   // not per-file (would be noisy on a sites with many .mjs files).
  const seenBroken = new Set<string>();
  for (const entry of toUpload) {
    const lastDot = entry.path.lastIndexOf('.');
    if (lastDot < 0) continue;
    const ext = entry.path.slice(lastDot).toLowerCase();
    if (KNOWN_BROKEN_EDGE_MIME.has(ext) && !seenBroken.has(ext)) {
      seenBroken.add(ext);
      ev({
        type: 'warn',
        message:
          `Bunny edge may serve "${ext}" as application/octet-stream regardless of upload Content-Type. ` +
          `Fix: declare in bunny.json (Bunny URL triggers use simple wildcards, not glob - \`*${ext}\` matches): ` +
          `"deploy.headers": [{ "pattern": "*${ext}", "headers": { "Content-Type": "${contentTypeFor('a' + ext)}" } }]`,
      });
    }
  }

  const uploadJobs = toUpload.map((entry) => async () => {
    if (!entry.absPath) throw new Error(`internal: missing absPath for ${entry.path}`);
    const ct = contentTypeFor(entry.path, mimeOverrides);
    // Stat first so the large-file warning fires even if readFile is slow.
    const st = await stat(entry.absPath);
    if (st.size > LARGE_FILE_THRESHOLD_BYTES) {
      ev({ type: 'large-file', path: entry.path, size: st.size });
    }
    if (opts.verbose) {
      ev({ type: 'mime', path: entry.path, contentType: ct, size: st.size });
    }
    const buf = await readFile(entry.absPath);
    await storageClient.putFile(zone, region, entry.path, buf, ct);
  });
  const uploadResults = await runPool(uploadJobs, {
    concurrency,
    onProgress: (completed, total) => {
      const last = toUpload[Math.max(0, completed - 1)];
      ev({ type: 'upload-progress', completed, total, path: last?.path ?? '' });
    },
  });
  const uploadSummary = summarizeResults(uploadResults);
  const failed: DeployResult['failed'] = uploadSummary.errors.map((e) => ({
    path: toUpload[e.index]?.path ?? '?',
    error: e.error.message,
  }));

  // 7. Optional delete orphans.
  let deleted = 0;
  if (opts.deleteOrphans && diff.byClass.orphan.length > 0) {
    ev({ type: 'phase', phase: 'delete', message: `${diff.byClass.orphan.length} orphan(s)` });
    const deleteJobs = diff.byClass.orphan.map((entry) => async () => {
      await storageClient.deleteFile(zone, region, entry.path);
    });
    const deleteResults = await runPool(deleteJobs, {
      concurrency,
      onProgress: (completed, total) => {
        const last = diff.byClass.orphan[Math.max(0, completed - 1)];
        ev({ type: 'delete-progress', completed, total, path: last?.path ?? '' });
      },
    });
    const ds = summarizeResults(deleteResults);
    deleted = ds.ok;
    for (const e of ds.errors) {
      failed.push({ path: diff.byClass.orphan[e.index]?.path ?? '?', error: e.error.message });
    }
  }

  // 8. Save fresh state cache.
  await saveState(stateFile, diff.newState);

  // 8b. Sync declarative edge rules (bunny.json deploy.headers + edgeRules)
  // to all configured PZs. Always runs when there's at least one PZ - when
  // both arrays are empty AND the PZ has previously-managed rules, this
  // cleans them up. Idempotent; managed-by-bunny-tools description marker
  // prevents touching user-added rules.
  //
  // Cost: one extra getPullZone() per PZ on every deploy (~50ms). Worth
  // it to prevent orphaned managed rules when users remove headers from
  // bunny.json. (rc.36 - was conditional on `hasDeclaredRules` in rc.34/35,
  // which orphaned rules on un-configure. See plans/reports/...rc35... )
  if (opts.config.deploy.pullZones.length > 0) {
    ev({ type: 'phase', phase: 'edge-rules-sync' });
    for (const pz of opts.config.deploy.pullZones) {
      try {
        const r = await syncEdgeRulesForPullZone(pz.id, opts.config);
        ev({
          type: 'edge-rules-sync',
          pullZoneId: r.pullZoneId,
          added: r.added,
          updated: r.updated,
          deleted: r.deleted,
        });
      } catch (err) {
        failed.push({
          path: `edge-rules-sync:${pz.id}`,
          error: (err as Error).message,
        });
      }
    }
  }

  // 9. Purge per pullZone config (or override).
  ev({ type: 'phase', phase: 'purge' });
  const purgeTargets: string[] = [];
  let purged = 0;
  for (const pz of opts.config.deploy.pullZones) {
    const policy = opts.purgeOverride ?? (typeof pz.purge === 'string' ? pz.purge : 'all');
    if (policy === 'none') continue;
    try {
      if (policy === 'all') {
        await acct.purgePullZone(pz.id);
        purgeTargets.push(`pull-zone:${pz.id}`);
        purged++;
      } else if (policy.startsWith('tag:')) {
        const tag = pz.tag ?? policy.slice(4);
        await acct.purgePullZoneByTag(pz.id, tag);
        purgeTargets.push(`pull-zone:${pz.id} tag=${tag}`);
        purged++;
      } else if (policy === 'paths') {
        // Per-URL purge for each uploaded file.
        for (const f of toUpload) {
          // Synthesize URL from pull-zone hostname; without it, fall back to skip.
          // Phase 3 will fetch hostnames; for now, purge full pull zone.
          await acct.purgePullZone(pz.id);
          purgeTargets.push(`pull-zone:${pz.id} (paths→all fallback for ${f.path})`);
          purged++;
          break;
        }
      }
    } catch (err) {
      failed.push({ path: `purge:${pz.id}`, error: (err as Error).message });
    }
  }
  ev({ type: 'purge', targets: purgeTargets });

  return {
    zone,
    region,
    uploaded: uploadSummary.ok,
    deleted,
    unchanged: diff.byClass.unchanged.length,
    failed,
    purged,
    durationMs: Date.now() - t0,
  };
}
