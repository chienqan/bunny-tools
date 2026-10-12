import type { ParsedInvocation } from '../../manifest/types.js';
import { listZones } from '../../core/dns.js';
import { printList } from '../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const flags = inv.flags as { json?: boolean };
  printList(await listZones(), {
    json: flags.json,
    empty: '(no DNS zones - add one with `bunny dns create <domain>`)',
    row: (z) => ({ id: z.Id, domain: z.Domain }),
  });
  return 0;
}
