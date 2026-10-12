import type { ParsedInvocation } from '../../../manifest/types.js';
import { addEdgeRule } from '../../../core/zones.js';
import type { EdgeRule } from '../../../core/zones.js';
import { resolvePullZoneId } from '../../../core/resolve.js';
import { createProgress } from '../../../ui/progress.js';
import { reportDone } from '../../../ui/output.js';
import { parseJsonFlag } from '../../../util/json-flag.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const progress = createProgress();
  const args = inv.args as { pullZone: string };
  const flags = inv.flags as { rule?: string; json?: boolean };
  const rule = parseJsonFlag<EdgeRule>(flags.rule, 'rule');
  const rules = await addEdgeRule(await resolvePullZoneId(args.pullZone), rule);
  reportDone(progress, flags.json, rules, `Added edge rule. Pull zone now has ${rules.length} rule(s).`);
  return 0;
}
