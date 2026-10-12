// core/purge - dispatch purge requests to the account API. UI-free.

import { createAccountClient } from '../api/account.js';
import type { AccountClient } from '../api/account.js';
import { resolveCredential } from '../config/credential-resolver.js';
import { ValidationError } from '../api/errors.js';
import { resolvePullZoneId } from './resolve.js';

export type PurgeTarget =
  | { kind: 'url'; url: string }
  | { kind: 'tag'; pullZoneId: number; tag: string }
  | { kind: 'pullzone'; pullZoneId: number }
  | { kind: 'all'; pullZoneIds: number[] };

export type PurgeResult = {
  ok: number;
  failed: Array<{ target: string; error: string }>;
};

export type PurgeRequest = {
  urls?: string[];
  // Pull zone name or numeric id.
  pullZone?: string | number;
  // Cache-Tag to purge within `pullZone` (origin must send Cache-Tag headers).
  tag?: string;
};

// Turn CLI/MCP purge input into concrete targets:
//   urls            → one URL purge each
//   pullZone        → full pull-zone purge
//   pullZone + tag  → tag purge on that zone
//   (nothing)       → every pull zone listed in bunny.json (handled by caller)
export async function resolvePurgeTargets(req: PurgeRequest): Promise<PurgeTarget[]> {
  const urls = req.urls ?? [];
  for (const u of urls) {
    if (!/^https?:\/\//.test(u)) {
      throw new ValidationError(`"${u}" is not a URL. Pass full URLs, or use --pull-zone <name|id> to purge a whole zone.`);
    }
  }
  if (req.tag && req.pullZone === undefined) {
    throw new ValidationError('--tag needs --pull-zone <name|id>.');
  }
  const targets: PurgeTarget[] = urls.map((url) => ({ kind: 'url', url }));
  if (req.pullZone !== undefined) {
    const pullZoneId = await resolvePullZoneId(req.pullZone);
    targets.push(req.tag ? { kind: 'tag', pullZoneId, tag: req.tag } : { kind: 'pullzone', pullZoneId });
  }
  return targets;
}

// High-level entry used by `bunny purge` and the MCP tool - instantiates its
// own client so the command layer doesn't need to import src/api/* directly.
export async function runPurgeTargets(targets: PurgeTarget[]): Promise<PurgeResult> {
  const client = createAccountClient({ resolveCredential: (s) => resolveCredential(s) });
  const total: PurgeResult = { ok: 0, failed: [] };
  for (const t of targets) {
    const r = await runPurge(client, t);
    total.ok += r.ok;
    total.failed.push(...r.failed);
  }
  return total;
}

export async function runPurge(
  client: AccountClient,
  target: PurgeTarget,
): Promise<PurgeResult> {
  const failed: PurgeResult['failed'] = [];
  let ok = 0;

  async function safe(label: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      ok++;
    } catch (err) {
      failed.push({ target: label, error: (err as Error).message });
    }
  }

  switch (target.kind) {
    case 'url':
      await safe(target.url, () => client.purgeByUrl(target.url));
      break;
    case 'tag':
      await safe(`pull-zone:${target.pullZoneId} tag=${target.tag}`, () =>
        client.purgePullZoneByTag(target.pullZoneId, target.tag),
      );
      break;
    case 'pullzone':
      await safe(`pull-zone:${target.pullZoneId}`, () => client.purgePullZone(target.pullZoneId));
      break;
    case 'all':
      for (const id of target.pullZoneIds) {
        await safe(`pull-zone:${id}`, () => client.purgePullZone(id));
      }
      break;
  }

  return { ok, failed };
}
