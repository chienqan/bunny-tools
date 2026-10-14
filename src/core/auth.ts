// core/auth - scope helpers + thin profile-aware wrappers around the resolver.
// CLI commands and MCP tools use these. UI-free.

import type { AuthScope } from '../api/http.js';
import {
  clearCredential,
  getActiveProfile,
  listScopesInProfile,
  maskCredential,
  resolveCredentialWithSource,
  scopeToAccount,
  setCredential,
} from '../config/credential-resolver.js';

export type StoredScope = {
  scope: string;
  storedIn: 'env' | 'keychain' | 'file' | 'unknown';
  masked: string;
};

export async function setKey(
  scope: AuthScope,
  value: string,
  opts: { profile?: string } = {},
): Promise<{ storedIn: 'keychain' | 'file'; profile: string }> {
  if (!value || value.length === 0) {
    throw new Error('Cannot store empty credential.');
  }
  return setCredential(scope, value, opts);
}

export async function clearKey(scope: AuthScope, opts: { profile?: string } = {}): Promise<void> {
  return clearCredential(scope, opts);
}

// List scopes available in the given profile (or active if omitted).
// Includes both stored credentials (keychain + file) AND env-based account
// credentials. The latter is the CI / non-interactive path: callers set
// BUNNY_API_KEY without ever running `bunny configure`. Pre-rc.47 this
// function only enumerated stored scopes, so `bunny whoami` reported
// "No credentials stored" in CI environments - misleading.
export async function listScopes(profile?: string): Promise<StoredScope[]> {
  const p = profile ?? (await getActiveProfile());
  const accounts = await listScopesInProfile(p);
  const out: StoredScope[] = [];
  for (const account of accounts) {
    const scope = parseAccountString(account);
    if (!scope) continue;
    try {
      const { value, source } = await resolveCredentialWithSource(scope, { profile: p });
      out.push({
        scope: scopeToAccount(scope),
        storedIn: source === 'env' || source === 'keychain' || source === 'file' ? source : 'unknown',
        masked: maskCredential(value),
      });
    } catch {
      // skip unresolvable
    }
  }
  // Surface env-based account key when it isn't already present from
  // stored scopes. We only check `account` here - per-zone storage/stream
  // env vars (BUNNY_STORAGE_PASSWORD_<ZONE>, etc.) need a zone name to
  // construct, and whoami works at account level.
  const envAccountKey = process.env['BUNNY_API_KEY'];
  if (
    envAccountKey &&
    envAccountKey.length > 0 &&
    !out.some((s) => s.scope === 'account')
  ) {
    out.push({
      scope: 'account',
      storedIn: 'env',
      masked: maskCredential(envAccountKey),
    });
  }
  return out;
}

// "storage:my-zone" / "stream:42" / "account" / "database:main" → AuthScope.
export function parseAccountString(raw: string): AuthScope | null {
  if (raw === 'account') return { kind: 'account' };
  const idx = raw.indexOf(':');
  if (idx < 0) return null;
  const kind = raw.slice(0, idx);
  const id = raw.slice(idx + 1);
  if (id.length === 0) return null;
  if (kind === 'storage') return { kind: 'storage', zone: id };
  if (kind === 'stream') return { kind: 'stream', libraryId: id };
  if (kind === 'database') return { kind: 'database', name: id };
  return null;
}

export function parseScopeFlag(scopeFlag: string): AuthScope {
  const parsed = parseAccountString(scopeFlag);
  if (!parsed) {
    throw new Error(
      `Invalid --scope value "${scopeFlag}". Use one of: account, storage:<zone>, stream:<lib>, database:<name>.`,
    );
  }
  return parsed;
}
