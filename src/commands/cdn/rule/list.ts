import type { ParsedInvocation } from '../../../manifest/types.js';
import { listEdgeRules } from '../../../core/zones.js';
import { resolvePullZoneId } from '../../../core/resolve.js';
import { printList } from '../../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const args = inv.args as { pullZone: string };
  const flags = inv.flags as { json?: boolean };
  const rules = await listEdgeRules(await resolvePullZoneId(args.pullZone));
  printList(rules, {
    json: flags.json,
    empty: '(no edge rules)',
    row: (r) => ({
      guid: r.Guid ?? '-',
      action: r.ActionType,
      enabled: String(r.Enabled ?? true),
      description: r.Description ?? '-',
    }),
  });
  return 0;
}
