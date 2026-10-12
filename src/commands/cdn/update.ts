import type { ParsedInvocation } from '../../manifest/types.js';
import { updatePullZone } from '../../core/zones.js';
import { resolvePullZoneId } from '../../core/resolve.js';
import { createProgress } from '../../ui/progress.js';
import { reportDone } from '../../ui/output.js';
import { parseJsonFlag } from '../../util/json-flag.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const progress = createProgress();
  const args = inv.args as { pullZone: string };
  const flags = inv.flags as { body?: string; json?: boolean };
  const body = parseJsonFlag(flags.body, 'body');
  const pz = await updatePullZone(await resolvePullZoneId(args.pullZone), body);
  reportDone(progress, flags.json, pz, `Updated pull zone ${args.pullZone}.`);
  return 0;
}
