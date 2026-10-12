import type { ParsedInvocation } from '../../manifest/types.js';
import { deletePullZone } from '../../core/zones.js';
import { resolvePullZoneId } from '../../core/resolve.js';
import { createProgress } from '../../ui/progress.js';
import { confirmDestructive, reportDone } from '../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const progress = createProgress();
  const args = inv.args as { pullZone: string };
  const flags = inv.flags as { yes?: boolean; json?: boolean };
  const id = await resolvePullZoneId(args.pullZone);
  if (!(await confirmDestructive(progress, flags.yes, `Delete pull zone ${args.pullZone} (id=${id})?`))) return 1;
  await deletePullZone(id);
  reportDone(progress, flags.json, { ok: true, id }, `Deleted pull zone ${args.pullZone}.`);
  return 0;
}
