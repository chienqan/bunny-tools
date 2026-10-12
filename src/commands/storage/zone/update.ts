import type { ParsedInvocation } from '../../../manifest/types.js';
import { updateStorageZone } from '../../../core/zones.js';
import { resolveStorageZoneId } from '../../../core/resolve.js';
import { createProgress } from '../../../ui/progress.js';
import { reportDone } from '../../../ui/output.js';
import { parseJsonFlag } from '../../../util/json-flag.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const progress = createProgress();
  const args = inv.args as { zone: string };
  const flags = inv.flags as { body?: string; json?: boolean };
  const body = parseJsonFlag(flags.body, 'body');
  const id = await resolveStorageZoneId(args.zone);
  const zone = await updateStorageZone(id, body);
  reportDone(progress, flags.json, zone, `Updated storage zone ${args.zone}.`);
  return 0;
}
