import type { ParsedInvocation } from '../../../manifest/types.js';
import { listLibraries } from '../../../core/stream.js';
import { printList } from '../../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const flags = inv.flags as { json?: boolean };
  printList(await listLibraries(), {
    json: flags.json,
    empty: '(no video libraries)',
    row: (l) => ({ id: l.Id, name: l.Name, storageZone: l.StorageZoneId ?? '-', pullZone: l.PullZoneId ?? '-' }),
  });
  return 0;
}
