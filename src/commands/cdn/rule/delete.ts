import type { ParsedInvocation } from '../../../manifest/types.js';
import { deleteEdgeRule } from '../../../core/zones.js';
import { resolvePullZoneId } from '../../../core/resolve.js';
import { createProgress } from '../../../ui/progress.js';
import { confirmDestructive, reportDone } from '../../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const progress = createProgress();
  const args = inv.args as { pullZone: string; guid: string };
  const flags = inv.flags as { yes?: boolean; json?: boolean };
  const id = await resolvePullZoneId(args.pullZone);
  if (!(await confirmDestructive(progress, flags.yes, `Delete edge rule ${args.guid} on ${args.pullZone}?`))) return 1;
  const rules = await deleteEdgeRule(id, args.guid);
  reportDone(progress, flags.json, rules, `Deleted edge rule ${args.guid}.`);
  return 0;
}
