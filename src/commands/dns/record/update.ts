import type { ParsedInvocation } from '../../../manifest/types.js';
import { updateRecord } from '../../../core/dns.js';
import { resolveDnsZoneId } from '../../../core/resolve.js';
import { createProgress } from '../../../ui/progress.js';
import { reportDone } from '../../../ui/output.js';
import { parseJsonFlag } from '../../../util/json-flag.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const progress = createProgress();
  const args = inv.args as { zone: string; recordId: string };
  const flags = inv.flags as { body?: string; json?: boolean };
  const body = parseJsonFlag(flags.body, 'body');
  const record = await updateRecord(await resolveDnsZoneId(args.zone), Number.parseInt(args.recordId, 10), body);
  reportDone(progress, flags.json, record ?? { ok: true }, `Updated record ${args.recordId} in ${args.zone}.`);
  return 0;
}
