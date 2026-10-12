import type { ParsedInvocation } from '../../manifest/types.js';
import { getPullZone } from '../../core/zones.js';
import { resolvePullZoneId } from '../../core/resolve.js';
import { printJson } from '../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const args = inv.args as { pullZone: string };
  printJson(await getPullZone(await resolvePullZoneId(args.pullZone)));
  return 0;
}
