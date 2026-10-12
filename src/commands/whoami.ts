// `bunny whoami` - show the current account context.
// Lists stored credential scopes (masked), counts zones reachable with the account key.

import type { ParsedInvocation } from '../manifest/types.js';
import { listScopes } from '../core/auth.js';
import { listStorageZones, listPullZones } from '../core/zones.js';
import { listZones as listDnsZones } from '../core/dns.js';
import { renderTable } from '../ui/table.js';
import { createProgress } from '../ui/progress.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const flags = inv.flags as { json?: boolean };
  const progress = createProgress();

  const scopes = await listScopes();

  // Probe what the account key can see - but don't fail hard if any product is unreachable.
  let storageCount: number | string = '?';
  let pullCount: number | string = '?';
  let dnsCount: number | string = '?';

  if (scopes.some((s) => s.scope === 'account')) {
    try {
      storageCount = (await listStorageZones()).length;
    } catch {
      storageCount = '(unreachable)';
    }
    try {
      pullCount = (await listPullZones()).length;
    } catch {
      pullCount = '(unreachable)';
    }
    try {
      dnsCount = (await listDnsZones()).length;
    } catch {
      dnsCount = '(unreachable)';
    }
  } else {
    progress.warn('No account credential set. Run `bunny configure` to store your API key.');
  }

  const summary = {
    scopes,
    counts: { storageZones: storageCount, pullZones: pullCount, dnsZones: dnsCount },
  };

  if (flags.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    return 0;
  }

  if (scopes.length === 0) {
    process.stdout.write('No credentials stored.\n');
    return 0;
  }

  process.stdout.write('Stored credentials:\n');
  process.stdout.write(renderTable(scopes.map((s) => ({ scope: s.scope, value: s.masked }))) + '\n\n');
  process.stdout.write('Resources reachable with current API key:\n');
  process.stdout.write(
    renderTable([
      { resource: 'storage zones', count: String(storageCount) },
      { resource: 'pull zones', count: String(pullCount) },
      { resource: 'dns zones', count: String(dnsCount) },
    ]) + '\n',
  );
  return 0;
}
