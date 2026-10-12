// `bunny storage upload <local> <zone/path>` - a trailing slash on the target
// keeps the local file name (`my-zone/img/` → `my-zone/img/<file>`).

import type { ParsedInvocation } from '../../manifest/types.js';
import { parseStorageTarget, uploadFile } from '../../core/storage-ops.js';
import { createProgress } from '../../ui/progress.js';
import { reportDone } from '../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const progress = createProgress();
  const args = inv.args as { local: string; target: string };
  const flags = inv.flags as { region?: string; json?: boolean };
  const target = parseStorageTarget(args.target);
  const remote = await uploadFile(args.local, target, flags.region ? { region: flags.region } : {});
  reportDone(progress, flags.json, { zone: target.zone, path: remote }, `Uploaded ${args.local} → ${target.zone}${remote}`);
  return 0;
}
