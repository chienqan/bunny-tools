import type { ParsedInvocation } from '../../manifest/types.js';
import { createZone } from '../../core/dns.js';
import { createProgress } from '../../ui/progress.js';
import { reportDone } from '../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const progress = createProgress();
  const args = inv.args as { domain: string };
  const flags = inv.flags as { json?: boolean };
  const zone = await createZone(args.domain);
  reportDone(progress, flags.json, zone, `Created DNS zone for ${zone.Domain} (id=${zone.Id}).`);
  return 0;
}
