// core/resolve - turn a user-supplied reference (name, domain, or numeric id)
// into the id Bunny's API wants.
//
// A JS number (MCP tools pass ids as numbers) is always an id. A string is
// looked up in the account's list: an all-digit string matching an existing
// id resolves to that id, otherwise the string is matched against names
// (case-insensitive). So a zone literally named "2024" is found by name
// instead of being misread as id 2024.

import { createAccountClient } from '../api/account.js';
import { createStreamClient } from '../api/stream.js';
import { ConfigError } from '../api/errors.js';
import { resolveCredential } from '../config/credential-resolver.js';

const NUMERIC = /^\d+$/;

function account() {
  return createAccountClient({ resolveCredential: (s) => resolveCredential(s) });
}

// Find one item by name; error lists what exists so the caller can retry.
export function pickByName<T>(
  items: T[],
  ref: string,
  nameOf: (item: T) => string,
  kind: string,
  listCommand: string,
): T {
  const needle = ref.trim().toLowerCase();
  const found = items.find((i) => nameOf(i).toLowerCase() === needle);
  if (found) return found;
  const names = items.map(nameOf);
  const shown = names.slice(0, 10).join(', ');
  const more = names.length > 10 ? `, … (+${names.length - 10})` : '';
  throw new ConfigError(
    `${kind} "${ref}" not found.` +
      (names.length > 0 ? ` Available: ${shown}${more}.` : ` None exist on this account.`) +
      ` See \`${listCommand}\`.`,
  );
}

// Resolve a string ref against a fetched list: exact id first (digit strings
// only), then name.
function resolveInList<T, Id extends number | string>(
  items: T[],
  ref: string,
  idOf: (item: T) => Id,
  nameOf: (item: T) => string,
  kind: string,
  listCommand: string,
): Id {
  if (NUMERIC.test(ref)) {
    const byId = items.find((i) => String(idOf(i)) === ref);
    if (byId) return idOf(byId);
  }
  return idOf(pickByName(items, ref, nameOf, kind, listCommand));
}

export async function resolvePullZoneId(ref: string | number): Promise<number> {
  if (typeof ref === 'number') return ref;
  const zones = await account().listPullZones();
  return resolveInList(zones, ref, (z) => z.Id, (z) => z.Name, 'Pull zone', 'bunny cdn list');
}

// DNS zones are referenced by domain. A trailing dot (FQDN form) is ignored.
export async function resolveDnsZoneId(ref: string | number): Promise<number> {
  if (typeof ref === 'number') return ref;
  const zones = await account().listDnsZones();
  return resolveInList(zones, ref.replace(/\.$/, ''), (z) => z.Id, (z) => z.Domain, 'DNS zone', 'bunny dns list');
}

export async function resolveStorageZoneId(ref: string | number): Promise<number> {
  if (typeof ref === 'number') return ref;
  const zones = await account().listStorageZones();
  return resolveInList(zones, ref, (z) => z.Id, (z) => z.Name, 'Storage zone', 'bunny storage ls');
}

export async function resolveLibraryId(ref: string | number): Promise<number> {
  if (typeof ref === 'number') return ref;
  const libs = await createStreamClient({ resolveCredential: (s) => resolveCredential(s) }).listLibraries();
  return resolveInList(libs, ref, (l) => l.Id, (l) => l.Name, 'Stream library', 'bunny stream library list');
}

export async function resolveScriptId(ref: string | number): Promise<number> {
  if (typeof ref === 'number') return ref;
  const scripts = await account().listEdgeScripts();
  return resolveInList(scripts, ref, (s) => s.Id, (s) => s.Name, 'Edge script', 'bunny scripting list');
}

// Container app ids are opaque strings, so match either the id or the name.
export async function resolveAppId(ref: string): Promise<string> {
  const apps = await account().listContainerApps();
  const byId = apps.find((a) => a.Id === ref);
  if (byId) return byId.Id;
  return pickByName(apps, ref, (a) => a.Name, 'Container app', 'bunny containers list').Id;
}
