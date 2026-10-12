import type { ParsedInvocation } from '../../../manifest/types.js';
import { deleteLibrary } from '../../../core/stream.js';
import { resolveLibraryId } from '../../../core/resolve.js';
import { createProgress } from '../../../ui/progress.js';
import { confirmDestructive, reportDone } from '../../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const progress = createProgress();
  const args = inv.args as { library: string };
  const flags = inv.flags as { yes?: boolean; json?: boolean };
  const id = await resolveLibraryId(args.library);
  if (!(await confirmDestructive(progress, flags.yes, `Delete video library ${args.library} (id=${id})? This is irreversible.`))) return 1;
  await deleteLibrary(id);
  reportDone(progress, flags.json, { ok: true, id }, `Deleted video library ${args.library}.`);
  return 0;
}
