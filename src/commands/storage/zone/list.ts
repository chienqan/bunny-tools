import type { ParsedInvocation } from '../../../manifest/types.js';
import { listStorageZones } from '../../../core/zones.js';
import { printList } from '../../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const flags = inv.flags as { json?: boolean };
  printList(await listStorageZones(), {
    json: flags.json,
    empty: '(no storage zones)',
    row: (z) => ({
      id: z.Id,
      name: z.Name,
      region: z.Region,
      files: z.FilesStored,
      bytes: z.StorageUsed,
      replication: z.ReplicationRegions.join(',') || '-',
    }),
  });
  return 0;
}
