// Vitest globalSetup — before the suite starts, find any `bt-e2e-*` resource
// older than the stale threshold and delete it. Catches leftovers from prior
// runs that failed before their cleanup phase. Returns no teardown hook.

import { bunnyCli } from './bunny-cli.js';
import { parseStaleAge } from './prefix.js';
import type { ResourceType } from './cleanup-registry.js';

// rc.55: tightened from 24h to 1h. Each suite run creates resources with a
// unique prefix (`bt-e2e-<pid>-<unixts>-...`), so concurrent runs don't
// collide; an orphan from one run never gets confused for an in-flight
// resource of another. Shorter window means leaked resources self-clean
// within an hour rather than a day. Original 24h was a paranoid hedge for
// non-prefixed resources that never existed in this codebase.
const STALE_AFTER_SEC = 60 * 60; // 1h

type ListedRow = { type: ResourceType; id: string; name: string };

export default async function setup(): Promise<void> {
  if (process.env['BUNNY_E2E'] !== '1') return;
  if (!process.env['BUNNY_API_KEY']) return;

  const stale: ListedRow[] = [];
  for (const type of ['storage-zone', 'cdn', 'dns', 'stream-library', 'scripting'] as const) {
    try {
      const rows = await listResources(type);
      for (const r of rows) {
        const age = parseStaleAge(r.name);
        if (age !== null && age > STALE_AFTER_SEC) stale.push(r);
      }
    } catch (err) {
      // Don't gate the suite on a sweep error, but make the failure visible
      // in the captured log so it lands in the GH issue body. A silent sweep
      // failure would let orphans pile up undetected.
      console.error(`[stale-sweep] list ${type} failed: ${(err as Error).message}`);
    }
  }

  for (const r of stale) {
    await deleteOne(r).catch((err) => {
      console.error(`[stale-sweep] delete ${r.type}:${r.id} failed: ${(err as Error).message}`);
    });
  }
}

async function listResources(type: ResourceType): Promise<ListedRow[]> {
  // Use --json instead of parsing the human table. Table column order is
  // a UI concern that may change with renderer tweaks; the JSON shape is
  // tied to the underlying Bunny API and is therefore much more stable.
  const args = (() => {
    switch (type) {
      case 'storage-zone':
        return ['storage', 'zone', 'list', '--json'];
      case 'cdn':
        return ['cdn', 'list', '--json'];
      case 'dns':
        return ['dns', 'list', '--json'];
      case 'stream-library':
        return ['stream', 'library', 'list', '--json'];
      case 'scripting':
        return ['scripting', 'list', '--json'];
      case 'container':
        return ['containers', 'list', '--json'];
    }
  })();
  const r = await bunnyCli(args);
  if (r.exitCode !== 0) return [];
  let rows: unknown;
  try {
    rows = JSON.parse(r.stdout);
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  const out: ListedRow[] = [];
  for (const raw of rows) {
    if (raw === null || typeof raw !== 'object') continue;
    const obj = raw as Record<string, unknown>;
    const id = obj['Id'];
    const name = (obj['Name'] ?? obj['Domain']) as unknown;
    if (typeof id !== 'number' && typeof id !== 'string') continue;
    if (typeof name !== 'string') continue;
    if (!name.startsWith('bt-e2e-')) continue;
    out.push({ type, id: String(id), name });
  }
  return out;
}

async function deleteOne(r: ListedRow): Promise<void> {
  const args = (() => {
    switch (r.type) {
      case 'storage-zone':
        return ['storage', 'zone', 'delete', r.id, '--yes'];
      case 'cdn':
        return ['cdn', 'delete', r.id, '--yes'];
      case 'dns':
        return ['dns', 'delete', r.id, '--yes'];
      case 'stream-library':
        return ['stream', 'library', 'delete', r.id, '--yes'];
      case 'scripting':
        return ['scripting', 'delete', r.id, '--yes'];
      case 'container':
        return ['containers', 'delete', r.id, '--yes'];
    }
  })();
  await bunnyCli(args);
}
