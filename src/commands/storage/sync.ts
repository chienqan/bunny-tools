// `bunny storage sync <dir> <zone[/path]>` - upload-only mirror of a local dir,
// no CDN purge. Reuses the walk + parallel-upload primitives from src/deploy/.

import type { ParsedInvocation } from '../../manifest/types.js';
import { join } from 'node:path';
import { walkPublicDir } from '../../deploy/walk.js';
import { runPool, summarizeResults } from '../../deploy/upload-queue.js';
import { parseStorageTarget, uploadMany } from '../../core/storage-ops.js';
import { createProgress } from '../../ui/progress.js';
import { reportDone } from '../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const progress = createProgress();
  const args = inv.args as { local: string; target: string };
  const flags = inv.flags as { region?: string; concurrency?: string; json?: boolean };
  const target = parseStorageTarget(args.target);
  const concurrency = flags.concurrency ? Number.parseInt(flags.concurrency, 10) : 8;
  const remoteRoot = target.path.replace(/\/+$/, '');

  const files = await walkPublicDir({ publicDir: args.local });
  progress.info(`syncing ${files.length} files to ${target.zone}${remoteRoot}/`);

  const jobs = await uploadMany(
    target.zone,
    files.map((f) => ({ local: join(args.local, f.path), remote: `${remoteRoot}/${f.path}` })),
    flags.region ? { region: flags.region } : {},
  );
  const results = await runPool(jobs, {
    concurrency,
    onProgress: (c, t) => progress.update(`uploaded ${c}/${t}`),
  });
  const sum = summarizeResults(results);
  if (sum.failed > 0) {
    for (const e of sum.errors) progress.warn(`${files[e.index]?.path ?? '?'}: ${e.error.message}`);
    progress.fail(`Sync finished with ${sum.failed} failure(s).`);
    return 2;
  }
  reportDone(progress, flags.json, { zone: target.zone, path: `${remoteRoot}/`, uploaded: sum.ok }, `Synced ${sum.ok} files.`);
  return 0;
}
