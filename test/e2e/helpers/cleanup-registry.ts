// Tracks resources created during a test so the suite-level afterAll can
// tear down survivors even when a test throws mid-flight. Each test should
// also use try/finally for its own cleanup — this is a backstop, not the
// primary mechanism.

import { bunnyCli } from './bunny-cli.js';

export type ResourceType =
  | 'storage-zone'
  | 'cdn'
  | 'dns'
  | 'stream-library'
  | 'scripting'
  | 'container';

type Resource = { type: ResourceType; id: string; label?: string };

const created: Resource[] = [];

export function register(type: ResourceType, id: string | number, label?: string): void {
  created.push({ type, id: String(id), ...(label ? { label } : {}) });
}

export function cleared(): Resource[] {
  return [...created];
}

export async function cleanupAll(): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;
  // Drain in reverse — most-recent first — so dependency order is roughly right
  // (e.g. a video registered after its library would be deleted first, though
  // for top-level resources this rarely matters).
  while (created.length > 0) {
    const r = created.pop()!;
    try {
      await deleteByType(r.type, r.id);
      deleted += 1;
    } catch (err) {
      // rc.55: surface cleanup failures to stderr so they appear in the
      // CI nightly log + the auto-created drift issue body. Pre-rc.55 a
      // silent catch made one failed run leak 3 resources without trace
      // (found rc.54 — a dispatch left bt-e2e-45568-* dangling for ~1.5h
      // before manual cleanup). stale-sweep still grabs them within 1h
      // even if this stderr line gets lost.
      failed += 1;
      // eslint-disable-next-line no-console
      console.error(`[cleanup] ${r.type}:${r.id}${r.label ? ` (${r.label})` : ''} failed: ${(err as Error).message}`);
    }
  }
  return { deleted, failed };
}

async function deleteByType(type: ResourceType, id: string): Promise<void> {
  const args: string[] = (() => {
    switch (type) {
      case 'storage-zone':
        return ['storage', 'zone', 'delete', id, '--yes'];
      case 'cdn':
        return ['cdn', 'delete', id, '--yes'];
      case 'dns':
        return ['dns', 'delete', id, '--yes'];
      case 'stream-library':
        return ['stream', 'library', 'delete', id, '--yes'];
      case 'scripting':
        return ['scripting', 'delete', id, '--yes'];
      case 'container':
        return ['containers', 'delete', id, '--yes'];
    }
  })();
  const r = await bunnyCli(args);
  if (r.exitCode !== 0 && !/not found|404/i.test(r.stderr)) {
    // Already-gone errors are fine (the test cleaned itself up); other
    // failures get surfaced.
    throw new Error(`cleanup ${type}:${id} failed: ${r.stderr.trim() || r.stdout.trim()}`);
  }
}
