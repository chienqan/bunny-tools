import type { ParsedInvocation } from '../../../manifest/types.js';
import { deleteVideo } from '../../../core/stream.js';
import { resolveLibraryId } from '../../../core/resolve.js';
import { createProgress } from '../../../ui/progress.js';
import { confirmDestructive, reportDone } from '../../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const progress = createProgress();
  const args = inv.args as { library: string; video: string };
  const flags = inv.flags as { yes?: boolean; json?: boolean };
  const libraryId = await resolveLibraryId(args.library);
  if (!(await confirmDestructive(progress, flags.yes, `Delete video ${args.video} from library ${args.library}?`))) return 1;
  await deleteVideo(libraryId, args.video);
  reportDone(progress, flags.json, { ok: true, libraryId, guid: args.video }, `Deleted video ${args.video}.`);
  return 0;
}
