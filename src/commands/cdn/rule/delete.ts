import type { ParsedInvocation } from '../../../manifest/types.js';
import { deleteEdgeRule } from '../../../core/zones.js';
import { resolvePullZoneId } from '../../../core/resolve.js';
import { createProgress } from '../../../ui/progress.js';
import { reportDone } from '../../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const progress = createProgress();
  const args = inv.args as { pullZone: string; guid: string };
  const flags = inv.flags as { json?: boolean };
  const rules = await deleteEdgeRule(await resolvePullZoneId(args.pullZone), args.guid);
  reportDone(progress, flags.json, rules, `Deleted edge rule ${args.guid}.`);
  return 0;
}
