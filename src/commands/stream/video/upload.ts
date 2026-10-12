import type { ParsedInvocation } from '../../../manifest/types.js';
import { uploadVideo } from '../../../core/stream.js';
import { resolveLibraryId } from '../../../core/resolve.js';
import { createProgress } from '../../../ui/progress.js';
import { reportDone } from '../../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const progress = createProgress();
  const args = inv.args as { library: string; file: string };
  const flags = inv.flags as { title?: string; collection?: string; json?: boolean };
  const libraryId = await resolveLibraryId(args.library);
  progress.start(`Uploading ${args.file} to library ${args.library}`);
  const r = await uploadVideo(libraryId, args.file, flags.title, flags.collection);
  reportDone(progress, flags.json, { libraryId, ...r }, `Uploaded ${r.bytes} bytes (guid=${r.guid}).`);
  return 0;
}
