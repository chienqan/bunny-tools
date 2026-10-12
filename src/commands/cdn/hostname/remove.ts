import type { ParsedInvocation } from '../../../manifest/types.js';
import { removePullZoneHostname } from '../../../core/zones.js';
import { resolvePullZoneId } from '../../../core/resolve.js';
import { createProgress } from '../../../ui/progress.js';
import { reportDone } from '../../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const progress = createProgress();
  const args = inv.args as { pullZone: string; hostname: string };
  const flags = inv.flags as { json?: boolean };
  const hosts = await removePullZoneHostname(await resolvePullZoneId(args.pullZone), args.hostname);
  reportDone(
    progress,
    flags.json,
    { ok: true, hostname: args.hostname, hostnames: hosts },
    `Unlinked ${args.hostname}. Pull zone now has ${hosts.length} hostname(s).`,
  );
  return 0;
}
