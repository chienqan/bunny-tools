import type { ParsedInvocation } from '../../manifest/types.js';
import { getZone } from '../../core/dns.js';
import { resolveDnsZoneId } from '../../core/resolve.js';
import { printJson } from '../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const args = inv.args as { zone: string };
  printJson(await getZone(await resolveDnsZoneId(args.zone)));
  return 0;
}
