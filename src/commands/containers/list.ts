import type { ParsedInvocation } from '../../manifest/types.js';
import { listApps } from '../../core/containers.js';
import { printList } from '../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const flags = inv.flags as { json?: boolean };
  printList(await listApps(), {
    json: flags.json,
    empty: '(no container apps)',
    row: (a) => ({ id: a.Id, name: a.Name, image: a.Image ?? '-', status: a.Status ?? '-', region: a.Region ?? '-' }),
  });
  return 0;
}
