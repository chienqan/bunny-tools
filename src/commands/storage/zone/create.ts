import type { ParsedInvocation } from '../../../manifest/types.js';
import { createStorageZone } from '../../../core/zones.js';
import { createProgress } from '../../../ui/progress.js';
import { reportDone } from '../../../ui/output.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const progress = createProgress();
  const args = inv.args as { name: string };
  const flags = inv.flags as { region?: string; replicate?: string; tier?: string; json?: boolean };
  // Bunny accepts only uppercase region codes (NY/LA/SG/...). Users naturally
  // type lowercase, so we normalize here rather than fail with a 400.
  const region = flags.region ? flags.region.toUpperCase() : undefined;
  const replicationRegions = flags.replicate
    ? flags.replicate.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
    : undefined;
  const tier = flags.tier?.toLowerCase();
  const zoneTier = tier === 'edge' ? 1 : tier === 'standard' ? 0 : undefined;
  const zone = await createStorageZone({
    name: args.name,
    ...(region ? { region } : {}),
    ...(replicationRegions ? { replicationRegions } : {}),
    ...(zoneTier !== undefined ? { zoneTier } : {}),
  });
  reportDone(progress, flags.json, zone, `Created storage zone ${zone.Name} (id=${zone.Id}, region=${zone.Region}).`);
  return 0;
}
