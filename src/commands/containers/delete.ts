import type { ParsedInvocation } from '../../manifest/types.js';
import { deleteApp } from '../../core/containers.js';
import { resolveAppId } from '../../core/resolve.js';
import { createProgress } from '../../ui/progress.js';
import { confirmDestructive, reportDone } from '../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const progress = createProgress();
  const args = inv.args as { app: string };
  const flags = inv.flags as { yes?: boolean; json?: boolean };
  const id = await resolveAppId(args.app);
  if (!(await confirmDestructive(progress, flags.yes, `Delete container app ${args.app} (id=${id})?`))) return 1;
  await deleteApp(id);
  reportDone(progress, flags.json, { ok: true, id }, `Deleted container app ${args.app}.`);
  return 0;
}
