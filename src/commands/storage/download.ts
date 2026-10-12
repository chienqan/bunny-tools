// `bunny storage download <zone/path> [local]` - local defaults to the remote file name.

import type { ParsedInvocation } from '../../manifest/types.js';
import { downloadFile, parseStorageTarget } from '../../core/storage-ops.js';
import { createProgress } from '../../ui/progress.js';
import { reportDone } from '../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const progress = createProgress();
  const args = inv.args as { target: string; local?: string };
  const flags = inv.flags as { region?: string; json?: boolean };
  const target = parseStorageTarget(args.target);
  const dest = await downloadFile(target, args.local, flags.region ? { region: flags.region } : {});
  reportDone(progress, flags.json, { zone: target.zone, path: target.path, local: dest }, `Downloaded ${target.zone}${target.path} → ${dest}`);
  return 0;
}
