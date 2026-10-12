import type { ParsedInvocation } from '../../../manifest/types.js';
import { listPullZoneHostnames } from '../../../core/zones.js';
import { resolvePullZoneId } from '../../../core/resolve.js';
import { printList } from '../../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const args = inv.args as { pullZone: string };
  const flags = inv.flags as { json?: boolean };
  const hosts = await listPullZoneHostnames(await resolvePullZoneId(args.pullZone));
  printList(hosts, { json: flags.json, empty: '(no hostnames)', row: (h) => ({ hostname: h }) });
  return 0;
}
