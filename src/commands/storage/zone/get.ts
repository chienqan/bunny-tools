import type { ParsedInvocation } from '../../../manifest/types.js';
import { getStorageZone } from '../../../core/zones.js';
import { printJson } from '../../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const args = inv.args as { zone: string };
  const ref = /^\d+$/.test(args.zone) ? Number.parseInt(args.zone, 10) : args.zone;
  printJson(await getStorageZone(ref));
  return 0;
}
