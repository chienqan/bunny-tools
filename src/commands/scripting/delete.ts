import type { ParsedInvocation } from '../../manifest/types.js';
import { deleteScript } from '../../core/scripting.js';
import { resolveScriptId } from '../../core/resolve.js';
import { createProgress } from '../../ui/progress.js';
import { confirmDestructive, reportDone } from '../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const progress = createProgress();
  const args = inv.args as { script: string };
  const flags = inv.flags as { yes?: boolean; json?: boolean };
  const id = await resolveScriptId(args.script);
  if (!(await confirmDestructive(progress, flags.yes, `Delete edge script ${args.script} (id=${id})?`))) return 1;
  await deleteScript(id);
  reportDone(progress, flags.json, { ok: true, id }, `Deleted edge script ${args.script}.`);
  return 0;
}
