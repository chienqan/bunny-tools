// core/whoami - account context shared by `bunny whoami` and the MCP tool:
// stored credential scopes (masked) and how many resources the account key reaches.

import { listScopes } from './auth.js';
import type { StoredScope } from './auth.js';
import { listStorageZones, listPullZones } from './zones.js';
import { listZones as listDnsZones } from './dns.js';

export type AccountSummary = {
  scopes: StoredScope[];
  counts: { storageZones: number | string; pullZones: number | string; dnsZones: number | string };
};

// Each product is probed independently; one unreachable product does not fail the summary.
async function count(fn: () => Promise<unknown[]>): Promise<number | string> {
  try {
    return (await fn()).length;
  } catch {
    return '(unreachable)';
  }
}

export async function getAccountSummary(): Promise<AccountSummary> {
  const scopes = await listScopes();
  if (!scopes.some((s) => s.scope === 'account')) {
    return { scopes, counts: { storageZones: '?', pullZones: '?', dnsZones: '?' } };
  }
  const [storageZones, pullZones, dnsZones] = await Promise.all([
    count(listStorageZones),
    count(listPullZones),
    count(listDnsZones),
  ]);
  return { scopes, counts: { storageZones, pullZones, dnsZones } };
}
