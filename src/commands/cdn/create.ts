import type { ParsedInvocation } from '../../manifest/types.js';
import { createPullZone } from '../../core/zones.js';
import { createProgress } from '../../ui/progress.js';
import { reportDone } from '../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const progress = createProgress();
  const args = inv.args as { name: string };
  const flags = inv.flags as { origin?: string; json?: boolean };
  if (!flags.origin) {
    progress.fail('--origin <url> is required, e.g. `bunny cdn create my-site --origin https://example.com`.');
    return 1;
  }
  const pz = await createPullZone(args.name, flags.origin);
  reportDone(progress, flags.json, pz, `Created pull zone ${pz.Name} (id=${pz.Id}).`);
  return 0;
}
