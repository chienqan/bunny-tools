// `bunny whoami` - show the current account context.
// Lists stored credential scopes (masked), counts zones reachable with the account key.

import type { ParsedInvocation } from '../manifest/types.js';
import { getAccountSummary } from '../core/whoami.js';
import { renderTable } from '../ui/table.js';
import { createProgress } from '../ui/progress.js';

export async function run(inv: ParsedInvocation): Promise<number> {
  const flags = inv.flags as { json?: boolean };
  const progress = createProgress();

  const summary = await getAccountSummary();
  const { scopes } = summary;
  const { storageZones: storageCount, pullZones: pullCount, dnsZones: dnsCount } = summary.counts;
  if (!scopes.some((s) => s.scope === 'account')) {
    progress.warn('No account credential set. Run `bunny configure` to store your API key.');
  }

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
