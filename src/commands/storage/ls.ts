// `bunny storage ls [zone[/path]]` - no argument lists every storage zone;
// `my-zone/dir` lists that directory. aws-s3 style addressing.

import type { ParsedInvocation } from '../../manifest/types.js';
import { listPath, listZones, parseStorageTarget } from '../../core/storage-ops.js';
import { printList } from '../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const args = inv.args as { target?: string };
  const flags = inv.flags as { recursive?: boolean; json?: boolean; region?: string };

  if (!args.target) {
    const zones = await listZones();
    printList(zones, {
      json: flags.json,
      empty: '(no storage zones - create one with `bunny storage zone create <name>`)',
      row: (z) => ({ zone: z.Name, region: z.Region, files: z.FilesStored, used: formatBytes(z.StorageUsed) }),
    });
    return 0;
  }

  const target = parseStorageTarget(args.target);
  const entries = await listPath(target, {
    ...(flags.recursive ? { recursive: true } : {}),
    ...(flags.region ? { region: flags.region } : {}),
  });
  printList(entries, {
    json: flags.json,
    empty: '(empty)',
    row: (e) => ({ kind: e.isDirectory ? 'dir' : 'file', size: e.isDirectory ? '-' : formatBytes(e.size), path: e.path }),
  });
  return 0;
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n)) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`;
}
