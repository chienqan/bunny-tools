// core/scoped-key-resolver - credential resolver with scoped-key fallback.
//
// The account API key can read every storage zone's `Password` and every Stream
// library's `ApiKey`. So a user who stored only their account key (via
// `bunny configure`) never has to paste per-zone or per-library secrets.
//
// Precedence per scope: explicitly stored key (flag/env/keychain/file) first,
// then the value fetched with the account key. Fetched secrets are memoized for
// the life of the process and never written to disk, so a rotated password is
// picked up on the next run.

import { createAccountClient } from '../api/account.js';
import { createStreamClient } from '../api/stream.js';
import { AuthError, ConfigError } from '../api/errors.js';
import type { AuthScope } from '../api/http.js';
import { resolveCredential } from '../config/credential-resolver.js';

const derived = new Map<string, Promise<string>>();

function accountResolver(scope: AuthScope): Promise<string> {
  return resolveCredential(scope);
}

async function deriveStoragePassword(zone: string): Promise<string> {
  const acct = createAccountClient({ resolveCredential: accountResolver });
  const meta = await acct.getStorageZoneByName(zone);
  if (!meta) {
    throw new ConfigError(`Storage zone "${zone}" not found on this account. Run \`bunny storage ls\` to see zones.`);
  }
  if (!meta.Password) throw new AuthError(`Bunny returned no password for storage zone "${zone}".`);
  return meta.Password;
}

async function deriveStreamKey(libraryId: string): Promise<string> {
  const id = Number.parseInt(libraryId, 10);
  if (!Number.isFinite(id)) throw new ConfigError(`Invalid Stream library id "${libraryId}".`);
  const stream = createStreamClient({ resolveCredential: accountResolver });
  const lib = await stream.getLibrary(id);
  if (!lib.ApiKey) throw new AuthError(`Bunny returned no API key for Stream library ${libraryId}.`);
  return lib.ApiKey;
}

function memo(key: string, fn: () => Promise<string>): Promise<string> {
  let p = derived.get(key);
  if (!p) {
    p = fn();
    // Drop failures so a later call (e.g. after `bunny configure`) can retry.
    p.catch(() => derived.delete(key));
    derived.set(key, p);
  }
  return p;
}

function derive(scope: AuthScope): Promise<string> | null {
  if (scope.kind === 'storage') return memo(`storage:${scope.zone}`, () => deriveStoragePassword(scope.zone));
  if (scope.kind === 'stream') return memo(`stream:${scope.libraryId}`, () => deriveStreamKey(scope.libraryId));
  return null;
}

function describeScope(scope: AuthScope): string {
  if (scope.kind === 'storage') return `storage zone "${scope.zone}"`;
  if (scope.kind === 'stream') return `Stream library ${scope.libraryId}`;
  return scope.kind;
}

export async function resolveScopedCredential(scope: AuthScope): Promise<string> {
  try {
    return await resolveCredential(scope);
  } catch (err) {
    if (!(err instanceof AuthError)) throw err;
    const fallback = derive(scope);
    if (!fallback) throw err;
    try {
      return await fallback;
    } catch (fallbackErr) {
      if (fallbackErr instanceof AuthError) {
        throw new AuthError(
          `No credential for ${describeScope(scope)}. Run \`bunny configure\` to store your API key ` +
            '(zone passwords and library keys are then fetched automatically).',
        );
      }
      throw fallbackErr;
    }
  }
}

// Test hook: clear memoized secrets between tests.
export function _resetDerivedKeys(): void {
  derived.clear();
}
