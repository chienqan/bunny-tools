// `bunny storage rm <zone/path> [-r]` - zone roots are refused; delete the zone instead.

import type { ParsedInvocation } from '../../manifest/types.js';
import { deletePath, parseStorageTarget } from '../../core/storage-ops.js';
import { createProgress } from '../../ui/progress.js';
import { confirmDestructive, reportDone } from '../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const progress = createProgress();
  const args = inv.args as { target: string };
  const flags = inv.flags as { recursive?: boolean; yes?: boolean; region?: string; json?: boolean };
  const target = parseStorageTarget(args.target);
  if (target.path === '/') {
    progress.fail(`Refusing to delete the root of "${target.zone}". Use \`bunny storage zone delete ${target.zone}\` to remove the zone.`);
    return 1;
  }
  const what = `${flags.recursive ? 'everything under' : 'file'} ${target.zone}${target.path}`;
  if (!(await confirmDestructive(progress, flags.yes, `Delete ${what}?`))) return 1;
  const count = await deletePath(target, {
    ...(flags.recursive ? { recursive: true } : {}),
    ...(flags.region ? { region: flags.region } : {}),
  });
  reportDone(progress, flags.json, { zone: target.zone, path: target.path, deleted: count }, `Deleted ${count} entr${count === 1 ? 'y' : 'ies'} from ${target.zone}.`);
  return 0;
}
