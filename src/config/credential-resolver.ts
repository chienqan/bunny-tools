// Credential-resolver chain: flag → env → OS keychain → JSON file → prompt.
// Profile-aware as of rc.9: a "profile" is a named bag of scopes (account, storage:<zone>, …).
// One profile is active at any time; the active profile is selected (in order):
//   --profile flag value > BUNNY_PROFILE env > file store's `active` field > 'default'.
//
// Migration from rc.8: if the credentials.json on disk is the old flat shape,
// it is auto-wrapped into a single `default` profile on first read.

import { atomicWriteJson, readJsonOrNull } from '../util/fs.js';
import { logger } from '../util/logger.js';
import { configDir, credentialsFile } from '../util/paths.js';
import { AuthError } from '../api/errors.js';
import type { AuthScope } from '../api/http.js';

const KEYCHAIN_SERVICE = 'bunny-tools';
const DEFAULT_PROFILE = 'default';

async function loadKeytar(): Promise<KeytarLike | null> {
  try {
    const mod = await import('keytar');
    const keytar =
      (mod as unknown as { default?: KeytarLike }).default ?? (mod as unknown as KeytarLike);
    return keytar;
  } catch (err) {
    logger.debug(`keytar unavailable; falling back to file storage: ${(err as Error).message}`);
    return null;
  }
}

type KeytarLike = {
  setPassword: (service: string, account: string, value: string) => Promise<void>;
  getPassword: (service: string, account: string) => Promise<string | null>;
  deletePassword: (service: string, account: string) => Promise<boolean>;
  findCredentials: (service: string) => Promise<Array<{ account: string; password: string }>>;
};

export function scopeToAccount(scope: AuthScope): string {
  switch (scope.kind) {
    case 'account':
      return 'account';
    case 'storage':
      return `storage:${scope.zone}`;
    case 'stream':
      return `stream:${scope.libraryId}`;
    case 'database':
      return `database:${scope.name}`;
  }
}

export function envVarSuffix(raw: string): string {
  const upper = raw.toUpperCase();
  let out = '';
  let runLen = 0;
  for (const ch of upper) {
    const safe = /[A-Z0-9]/.test(ch) ? ch : '_';
    if (safe === '_') {
      runLen++;
    } else {
      if (runLen > 0) {
        out += runLen === 1 ? '_' : `_X${runLen}`;
      }
      out += ch;
      runLen = 0;
    }
  }
  if (runLen > 0) out += runLen === 1 ? '_' : `_X${runLen}`;
  return out;
}

export function scopeToEnvVars(scope: AuthScope): string[] {
  switch (scope.kind) {
    case 'account':
      return ['BUNNY_API_KEY'];
    case 'storage':
      return [`BUNNY_STORAGE_PASSWORD_${envVarSuffix(scope.zone)}`, 'BUNNY_STORAGE_PASSWORD'];
    case 'stream':
      return [`BUNNY_STREAM_KEY_${envVarSuffix(scope.libraryId)}`, 'BUNNY_STREAM_KEY'];
    case 'database':
      return [`BUNNY_DATABASE_KEY_${envVarSuffix(scope.name)}`];
  }
}

// File store schema (rc.9).
export type FileStore = {
  active: string;
  profiles: Record<string, Record<string, string>>;
};

// Read raw, normalize old flat shape into nested-with-default-profile shape.
async function readFileStore(): Promise<FileStore> {
  const raw = await readJsonOrNull<unknown>(credentialsFile());
  return normalizeFileStore(raw);
}

export function normalizeFileStore(raw: unknown): FileStore {
  if (!raw || typeof raw !== 'object') {
    return { active: DEFAULT_PROFILE, profiles: {} };
  }
  const r = raw as Record<string, unknown>;
  // Already in new shape?
  if ('profiles' in r && r['profiles'] && typeof r['profiles'] === 'object') {
    const active = typeof r['active'] === 'string' && r['active'].length > 0 ? r['active'] : DEFAULT_PROFILE;
    return { active, profiles: r['profiles'] as Record<string, Record<string, string>> };
  }
  // Old flat shape - wrap entries into the default profile.
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(r)) {
    if (typeof v === 'string') flat[k] = v;
  }
  return { active: DEFAULT_PROFILE, profiles: { [DEFAULT_PROFILE]: flat } };
}

async function writeFileStore(store: FileStore): Promise<void> {
  await atomicWriteJson(credentialsFile(), store, { mode: 0o600 });
}

export type ResolverOverrides = {
  flag?: string;
  prompt?: (scope: AuthScope) => Promise<string>;
  keytar?: KeytarLike | null;
  profile?: string; // explicit profile override; otherwise pulls from active
  // false = ignore the generic BUNNY_STORAGE_PASSWORD / BUNNY_STREAM_KEY, which
  // apply to every zone/library. Callers that can fetch the exact per-zone key
  // pass false so a generic value for zone A is never sent to zone B.
  genericEnv?: boolean;
};

export async function getActiveProfile(): Promise<string> {
  const fromEnv = process.env['BUNNY_PROFILE'];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  const store = await readFileStore();
  return store.active || DEFAULT_PROFILE;
}

function keychainAccount(profile: string, scope: AuthScope): string {
  return `${profile}:${scopeToAccount(scope)}`;
}

export async function resolveCredential(
  scope: AuthScope,
  overrides: ResolverOverrides = {},
): Promise<string> {
  if (overrides.flag && overrides.flag.length > 0) return overrides.flag;

  const profile = overrides.profile ?? (await getActiveProfile());

  // Env vars (still global; treated as targeting the active profile).
  // For storage/stream the list is [scoped, generic].
  const envNames = scopeToEnvVars(scope);
  const usableEnv =
    overrides.genericEnv === false && (scope.kind === 'storage' || scope.kind === 'stream')
      ? envNames.slice(0, 1)
      : envNames;
  for (const name of usableEnv) {
    const v = process.env[name];
    if (v && v.length > 0) return v;
  }

  // Keychain. Try `<profile>:<scope>` first; for the default profile, fall back
  // to bare `<scope>` so rc.8-era keychain entries still resolve.
  const keytar = overrides.keytar !== undefined ? overrides.keytar : await loadKeytar();
  if (keytar) {
    try {
      const v = await keytar.getPassword(KEYCHAIN_SERVICE, keychainAccount(profile, scope));
      if (v && v.length > 0) return v;
      if (profile === DEFAULT_PROFILE) {
        const legacy = await keytar.getPassword(KEYCHAIN_SERVICE, scopeToAccount(scope));
        if (legacy && legacy.length > 0) return legacy;
      }
    } catch (err) {
      logger.debug(`keychain read failed: ${(err as Error).message}`);
    }
  }

  // File store.
  const store = await readFileStore();
  const profileBag = store.profiles[profile];
  if (profileBag) {
    const fileVal = profileBag[scopeToAccount(scope)];
    if (fileVal && fileVal.length > 0) return fileVal;
  }

  if (overrides.prompt && process.stdin.isTTY) {
    return overrides.prompt(scope);
  }

  throw new AuthError(
    `No credential for scope ${scopeToAccount(scope)} in profile "${profile}". ` +
      `Set via \`bunny configure${profile !== DEFAULT_PROFILE ? ` --profile=${profile}` : ''}\` ` +
      `or env (${scopeToEnvVars(scope).join(', ')}).`,
  );
}

export async function setCredential(
  scope: AuthScope,
  value: string,
  overrides: { keytar?: KeytarLike | null; profile?: string } = {},
): Promise<{ storedIn: 'keychain' | 'file'; profile: string }> {
  const profile = overrides.profile ?? (await getActiveProfile());
  const keytar = overrides.keytar !== undefined ? overrides.keytar : await loadKeytar();
  if (keytar) {
    try {
      await keytar.setPassword(KEYCHAIN_SERVICE, keychainAccount(profile, scope), value);
      return { storedIn: 'keychain', profile };
    } catch (err) {
      logger.debug(`keychain write failed; falling back to file: ${(err as Error).message}`);
    }
  }
  const store = await readFileStore();
  if (!store.profiles[profile]) store.profiles[profile] = {};
  store.profiles[profile][scopeToAccount(scope)] = value;
  await writeFileStore(store);
  return { storedIn: 'file', profile };
}

export async function clearCredential(
  scope: AuthScope,
  overrides: { keytar?: KeytarLike | null; profile?: string } = {},
): Promise<void> {
  const profile = overrides.profile ?? (await getActiveProfile());
  const keytar = overrides.keytar !== undefined ? overrides.keytar : await loadKeytar();
  if (keytar) {
    try {
      await keytar.deletePassword(KEYCHAIN_SERVICE, keychainAccount(profile, scope));
      // Also clear the legacy bare entry for the default profile.
      if (profile === DEFAULT_PROFILE) {
        await keytar.deletePassword(KEYCHAIN_SERVICE, scopeToAccount(scope));
      }
    } catch (err) {
      logger.debug(`keychain delete failed: ${(err as Error).message}`);
    }
  }
  const store = await readFileStore();
  if (store.profiles[profile]) {
    delete store.profiles[profile][scopeToAccount(scope)];
  }
  await writeFileStore(store);
}

// Profile-management helpers (used by `bunny configure list/switch/remove`).
export async function listProfiles(): Promise<{ active: string; profiles: string[] }> {
  const store = await readFileStore();
  return { active: store.active, profiles: Object.keys(store.profiles).sort() };
}

export async function setActiveProfile(name: string): Promise<void> {
  const store = await readFileStore();
  if (!store.profiles[name]) {
    throw new AuthError(`Profile "${name}" not found. Run \`bunny configure --profile=${name}\` to create it.`);
  }
  store.active = name;
  await writeFileStore(store);
}

export async function removeProfile(
  name: string,
  overrides: { keytar?: KeytarLike | null } = {},
): Promise<void> {
  const store = await readFileStore();
  const profileBag = store.profiles[name];
  if (!profileBag) {
    throw new AuthError(`Profile "${name}" not found.`);
  }
  // Clean up keychain entries for this profile.
  const keytar = overrides.keytar !== undefined ? overrides.keytar : await loadKeytar();
  if (keytar) {
    try {
      const creds = await keytar.findCredentials(KEYCHAIN_SERVICE);
      for (const c of creds) {
        if (c.account.startsWith(`${name}:`)) {
          await keytar.deletePassword(KEYCHAIN_SERVICE, c.account);
        }
      }
    } catch (err) {
      logger.debug(`keychain cleanup failed: ${(err as Error).message}`);
    }
  }
  delete store.profiles[name];
  if (store.active === name) store.active = DEFAULT_PROFILE;
  await writeFileStore(store);
}

export function maskCredential(value: string): string {
  if (value.length <= 4) return '***';
  return `***${value.slice(-4)}`;
}

// List scopes stored within a single profile (file + keychain merged).
export async function listScopesInProfile(
  profile: string,
  overrides: { keytar?: KeytarLike | null } = {},
): Promise<string[]> {
  const found = new Set<string>();
  const store = await readFileStore();
  const bag = store.profiles[profile];
  if (bag) for (const k of Object.keys(bag)) found.add(k);
  const keytar = overrides.keytar !== undefined ? overrides.keytar : await loadKeytar();
  if (keytar) {
    try {
      const creds = await keytar.findCredentials(KEYCHAIN_SERVICE);
      const prefix = `${profile}:`;
      for (const c of creds) {
        if (c.account.startsWith(prefix)) {
          found.add(c.account.slice(prefix.length));
        } else if (profile === DEFAULT_PROFILE && !c.account.includes(':')) {
          // Legacy bare entry from rc.8 (only `account` is valid in this case).
          found.add(c.account);
        }
      }
    } catch (err) {
      logger.debug(`keychain list failed: ${(err as Error).message}`);
    }
  }
  return [...found].sort();
}

// Backwards-compat shim for code still calling listCredentialScopes() - returns
// the active profile's scopes, prefixed with `<profile>:` for clarity.
export async function listCredentialScopes(
  overrides: { keytar?: KeytarLike | null } = {},
): Promise<string[]> {
  const profile = await getActiveProfile();
  const scopes = await listScopesInProfile(profile, overrides);
  return scopes.map((s) => `${profile}:${s}`);
}

export const _internal = { configDir, credentialsFile, KEYCHAIN_SERVICE, DEFAULT_PROFILE };
