import type { ParsedInvocation } from '../../../manifest/types.js';
import { getStorageZone } from '../../../core/zones.js';
import { resolveStorageZoneId } from '../../../core/resolve.js';
import { printJson } from '../../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const args = inv.args as { zone: string };
  printJson(await getStorageZone(await resolveStorageZoneId(args.zone)));
  return 0;
}
