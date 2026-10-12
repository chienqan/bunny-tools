// `bunny purge` - standalone CDN cache purge.
//   bunny purge <url...>                        purge specific URLs
//   bunny purge --pull-zone <name|id>           purge a whole pull zone
//   bunny purge --pull-zone <name|id> --tag t   purge one Cache-Tag
//   bunny purge                                 purge the pull zones in bunny.json

import type { ParsedInvocation } from '../manifest/types.js';
import { resolvePurgeTargets, runPurgeTargets } from '../core/purge.js';
import type { PurgeTarget } from '../core/purge.js';
import { loadBunnyJson } from '../config/bunny-json.js';
import { createProgress } from '../ui/progress.js';
import { printJson } from '../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const progress = createProgress();
  const args = inv.args as { urls?: string[] };
  const flags = inv.flags as { pullZone?: string; tag?: string; json?: boolean };

  let targets: PurgeTarget[] = await resolvePurgeTargets({
    urls: args.urls ?? [],
    ...(flags.pullZone ? { pullZone: flags.pullZone } : {}),
    ...(flags.tag ? { tag: flags.tag } : {}),
  });

  if (targets.length === 0) {
    const ids = await loadBunnyJson()
      .then(({ config }) => config.deploy.pullZones.map((p) => p.id))
      .catch(() => [] as number[]);
    if (ids.length === 0) {
      progress.fail('Nothing to purge. Pass URLs, or `--pull-zone <name|id>` (see `bunny cdn list`).');
      return 1;
    }
    targets = [{ kind: 'all', pullZoneIds: ids }];
  }

  const result = await runPurgeTargets(targets);
  // Any failed target is a (partial) failure: exit 2, per the output contract.
  if (flags.json) {
    printJson(result);
    return result.failed.length > 0 ? 2 : 0;
  }
  for (const f of result.failed) progress.warn(`${f.target}: ${f.error}`);
  if (result.failed.length > 0) {
    progress.fail(result.ok === 0 ? 'Purge failed.' : `Purge partly failed (${result.failed.length} of ${result.ok + result.failed.length}).`);
    return 2;
  }
  progress.succeed(`Purged ${result.ok} target(s).`);
  return 0;
}
