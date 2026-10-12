import type { ParsedInvocation } from '../../../manifest/types.js';
import { deleteStorageZone } from '../../../core/zones.js';
import { resolveStorageZoneId } from '../../../core/resolve.js';
import { createProgress } from '../../../ui/progress.js';
import { confirmDestructive, reportDone } from '../../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const progress = createProgress();
  const args = inv.args as { zone: string };
  const flags = inv.flags as { yes?: boolean; json?: boolean };
  const id = await resolveStorageZoneId(args.zone);
  if (!(await confirmDestructive(progress, flags.yes, `Delete storage zone ${args.zone} (id=${id}) and all its files?`))) return 1;
  await deleteStorageZone(id);
  reportDone(progress, flags.json, { ok: true, id }, `Deleted storage zone ${args.zone}.`);
  return 0;
}
