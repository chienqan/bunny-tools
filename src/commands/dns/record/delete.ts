import type { ParsedInvocation } from '../../../manifest/types.js';
import { deleteRecord } from '../../../core/dns.js';
import { resolveDnsZoneId } from '../../../core/resolve.js';
import { createProgress } from '../../../ui/progress.js';
import { confirmDestructive, reportDone } from '../../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const progress = createProgress();
  const args = inv.args as { zone: string; recordId: string };
  const flags = inv.flags as { yes?: boolean; json?: boolean };
  const zoneId = await resolveDnsZoneId(args.zone);
  if (!(await confirmDestructive(progress, flags.yes, `Delete record ${args.recordId} in ${args.zone}?`))) return 1;
  await deleteRecord(zoneId, Number.parseInt(args.recordId, 10));
  reportDone(progress, flags.json, { ok: true, recordId: Number.parseInt(args.recordId, 10) }, `Deleted record ${args.recordId}.`);
  return 0;
}
