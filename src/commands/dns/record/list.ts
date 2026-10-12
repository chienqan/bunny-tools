import type { ParsedInvocation } from '../../../manifest/types.js';
import { listRecords, recordTypeName } from '../../../core/dns.js';
import { resolveDnsZoneId } from '../../../core/resolve.js';
import { printList } from '../../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const args = inv.args as { zone: string };
  const flags = inv.flags as { type?: string; json?: boolean };
  let records = await listRecords(await resolveDnsZoneId(args.zone));
  if (flags.type) {
    const want = flags.type.toUpperCase();
    records = records.filter((r) => recordTypeName(r.Type) === want);
  }
  printList(records, {
    json: flags.json,
    empty: '(no records)',
    row: (r) => ({ id: r.Id, type: recordTypeName(r.Type), name: r.Name || '@', value: r.Value, ttl: r.Ttl ?? '-' }),
  });
  return 0;
}
