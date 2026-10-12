// core/resolve - turn a user-supplied reference (name, domain, or numeric id)
// into the id Bunny's API wants. Numeric refs pass through without a network
// call; anything else is looked up by name (case-insensitive).

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

export async function resolvePullZoneId(ref: string | number): Promise<number> {
  if (typeof ref === 'number') return ref;
  if (NUMERIC.test(ref)) return Number.parseInt(ref, 10);
  const zones = await account().listPullZones();
  return pickByName(zones, ref, (z) => z.Name, 'Pull zone', 'bunny cdn list').Id;
}

// DNS zones are referenced by domain. A trailing dot (FQDN form) is ignored.
export async function resolveDnsZoneId(ref: string | number): Promise<number> {
  if (typeof ref === 'number') return ref;
  if (NUMERIC.test(ref)) return Number.parseInt(ref, 10);
  const zones = await account().listDnsZones();
  return pickByName(zones, ref.replace(/\.$/, ''), (z) => z.Domain, 'DNS zone', 'bunny dns list').Id;
}

export async function resolveStorageZoneId(ref: string | number): Promise<number> {
  if (typeof ref === 'number') return ref;
  if (NUMERIC.test(ref)) return Number.parseInt(ref, 10);
  const zones = await account().listStorageZones();
  return pickByName(zones, ref, (z) => z.Name, 'Storage zone', 'bunny storage ls').Id;
}

export async function resolveLibraryId(ref: string | number): Promise<number> {
  if (typeof ref === 'number') return ref;
  if (NUMERIC.test(ref)) return Number.parseInt(ref, 10);
  const libs = await createStreamClient({ resolveCredential: (s) => resolveCredential(s) }).listLibraries();
  return pickByName(libs, ref, (l) => l.Name, 'Stream library', 'bunny stream library list').Id;
}

export async function resolveScriptId(ref: string | number): Promise<number> {
  if (typeof ref === 'number') return ref;
  if (NUMERIC.test(ref)) return Number.parseInt(ref, 10);
  const scripts = await account().listEdgeScripts();
  return pickByName(scripts, ref, (s) => s.Name, 'Edge script', 'bunny scripting list').Id;
}

// Container app ids are opaque strings, so match either the id or the name.
export async function resolveAppId(ref: string): Promise<string> {
  const apps = await account().listContainerApps();
  const byId = apps.find((a) => a.Id === ref);
  if (byId) return byId.Id;
  return pickByName(apps, ref, (a) => a.Name, 'Container app', 'bunny containers list').Id;
}
