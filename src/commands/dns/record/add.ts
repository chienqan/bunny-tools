import type { ParsedInvocation } from '../../../manifest/types.js';
import { addRecord, SUPPORTED_TYPES } from '../../../core/dns.js';
import { getPullZone } from '../../../core/zones.js';
import { resolveDnsZoneId, resolvePullZoneId } from '../../../core/resolve.js';
import { formatBunnyError } from '../../../util/format-error.js';
import { createProgress } from '../../../ui/progress.js';
import { printJson } from '../../../ui/output.js';

// Re-exported for tests; canonical implementation lives in core/dns.
export { computeFqdn } from '../../../core/dns.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const progress = createProgress();
  const args = inv.args as { zone: string; type: string; name: string; value?: string };
  const flags = inv.flags as {
    ttl?: string;
    priority?: string;
    weight?: string;
    port?: string;
    flags?: string;
    tag?: string;
    linkName?: string;
    pullZone?: string;
    json?: boolean;
  };
  const upperType = args.type.toUpperCase();
  if (!(SUPPORTED_TYPES as readonly string[]).includes(upperType)) {
    progress.fail(`Unsupported record type "${args.type}". Supported: ${SUPPORTED_TYPES.join(', ')}.`);
    return 1;
  }

  // Convenience: --pull-zone=<name|id> auto-resolves to the pull zone's name and
  // sets LinkName=<id>. Saves users the `bunny cdn get <pull-zone>` step for
  // the common "wire DNS to a pull zone" workflow. The hostname-linked +
  // cert-issued pre-flight lives in core/dns.addRecord and runs for every
  // PULLZONE record (CLI with or without this flag, MCP, etc.).
  let resolvedValue = args.value;
  let resolvedLinkName = flags.linkName;
  if (flags.pullZone) {
    if (upperType !== 'PULLZONE') {
      progress.fail('--pull-zone only applies to PULLZONE record type.');
      return 1;
    }
    try {
      const pz = await getPullZone(await resolvePullZoneId(flags.pullZone));
      resolvedValue = resolvedValue ?? pz.Name;
      resolvedLinkName = resolvedLinkName ?? String(pz.Id);
    } catch (err) {
      progress.fail(`--pull-zone lookup failed: ${(err as Error).message}`);
      return 1;
    }
  }

  if (!resolvedValue) {
    progress.fail('Missing <value>. For PULLZONE: pass the pz name or use --pull-zone <name|id>.');
    return 1;
  }

  const raw = {
    type: upperType,
    name: args.name,
    value: resolvedValue,
    ...(flags.ttl ? { ttl: Number.parseInt(flags.ttl, 10) } : {}),
    ...(flags.priority !== undefined ? { priority: Number.parseInt(flags.priority, 10) } : {}),
    ...(flags.weight !== undefined ? { weight: Number.parseInt(flags.weight, 10) } : {}),
    ...(flags.port !== undefined ? { port: Number.parseInt(flags.port, 10) } : {}),
    ...(flags.flags !== undefined ? { flags: Number.parseInt(flags.flags, 10) } : {}),
    ...(flags.tag ? { tag: flags.tag } : {}),
    ...(resolvedLinkName ? { linkName: resolvedLinkName } : {}),
  };
  try {
    const created = await addRecord(await resolveDnsZoneId(args.zone), raw);
    if (flags.json) {
      printJson(created);
      return 0;
    }
    progress.succeed(`Added ${upperType} record (id=${created.Id}).`);
    // Bunny auto-spawns a hidden pull zone when the record type needs CDN
    // acceleration (notably REDIRECT). Surface that side effect so the user
    // isn't surprised by a phantom PZ in their account.
    if (created.AcceleratedPullZoneId && created.AcceleratedPullZoneId > 0) {
      progress.info(
        `Bunny auto-created pull zone ${created.AcceleratedPullZoneId} to handle this ${upperType} record.`,
      );
    }
    return 0;
  } catch (err) {
    progress.fail(formatBunnyError(err));
    return 1;
  }
}
