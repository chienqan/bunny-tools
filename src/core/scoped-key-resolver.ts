// core/scoped-key-resolver - credential resolver with scoped-key fallback.
//
// The account API key can read every storage zone's `Password` and every Stream
// library's `ApiKey`. So a user who stored only their account key (via
// `bunny configure`) never has to paste per-zone or per-library secrets.
//
// Precedence per scope: key stored for that exact zone/library (scoped env,
// keychain, file), then the value fetched with the account key, then the
// generic BUNNY_STORAGE_PASSWORD / BUNNY_STREAM_KEY (last, because it applies to
// every zone and would be wrong for all but one). Fetched secrets are memoized
// for the life of the process and never written to disk, so a rotated password
// is picked up on the next run.

import { createAccountClient } from '../api/account.js';
import { createStreamClient } from '../api/stream.js';
import { AuthError, ConfigError, MissingCredentialError } from '../api/errors.js';
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
  if (scope.kind !== 'storage' && scope.kind !== 'stream') return resolveCredential(scope);
  try {
    return await resolveCredential(scope, { genericEnv: false });
  } catch (err) {
    if (!(err instanceof MissingCredentialError)) throw err;
    try {
      return await derive(scope)!;
    } catch (fallbackErr) {
      // No account key (e.g. CI with only a generic zone password): use the generic env var.
      const generic = await resolveCredential(scope).catch(() => null);
      if (generic) return generic;
      // Only say "no credential" when none exists. A rejected (wrong or
      // revoked) account key surfaces as-is with its own hint.
      if (fallbackErr instanceof MissingCredentialError) {
        throw new MissingCredentialError(
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
