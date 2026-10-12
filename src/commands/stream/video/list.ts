import type { ParsedInvocation } from '../../../manifest/types.js';
import { listVideos } from '../../../core/stream.js';
import { resolveLibraryId } from '../../../core/resolve.js';
import { printList } from '../../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const args = inv.args as { library: string };
  const flags = inv.flags as { collection?: string; json?: boolean };
  const videos = await listVideos(await resolveLibraryId(args.library), flags.collection);
  printList(videos, {
    json: flags.json,
    empty: '(no videos)',
    row: (v) => ({ guid: v.guid, title: v.title, length: v.length, views: v.views, status: v.status }),
  });
  return 0;
}
