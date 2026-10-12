import type { ParsedInvocation } from '../../manifest/types.js';
import { deleteZone } from '../../core/dns.js';
import { resolveDnsZoneId } from '../../core/resolve.js';
import { createProgress } from '../../ui/progress.js';
import { confirmDestructive, reportDone } from '../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const progress = createProgress();
  const args = inv.args as { zone: string };
  const flags = inv.flags as { yes?: boolean; json?: boolean };
  const id = await resolveDnsZoneId(args.zone);
  if (!(await confirmDestructive(progress, flags.yes, `Delete DNS zone ${args.zone} (id=${id}) and all its records? This is irreversible.`))) return 1;
  await deleteZone(id);
  reportDone(progress, flags.json, { ok: true, id }, `Deleted DNS zone ${args.zone}.`);
  return 0;
}
