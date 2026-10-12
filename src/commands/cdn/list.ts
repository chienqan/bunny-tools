import type { ParsedInvocation } from '../../manifest/types.js';
import { listPullZones } from '../../core/zones.js';
import { printList } from '../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const flags = inv.flags as { json?: boolean };
  printList(await listPullZones(), {
    json: flags.json,
    empty: '(no pull zones - create one with `bunny cdn create <name> --origin <url>`)',
    row: (z) => ({
      id: z.Id,
      name: z.Name,
      origin: z.OriginUrl ?? '-',
      enabled: String(z.Enabled),
      hostnames: z.Hostnames.map((h) => h.Value).join(',') || '-',
    }),
  });
  return 0;
}
