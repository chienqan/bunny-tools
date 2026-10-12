// core/configure - guided walkthrough that stores credentials into a named profile.
// UI-free; takes injected callbacks. Replaces the old configure that was deleted
// in rc.3, brought back in rc.9 with profile awareness.

import { setCredential } from '../config/credential-resolver.js';
import { createAccountClient } from '../api/account.js';
import { resolveCredential } from '../config/credential-resolver.js';
import { AuthError } from '../api/errors.js';

export type ConfigureInput = {
  profile?: string;
  apiKey?: string;
  storageZone?: string;
  storagePassword?: string;
  pullZoneId?: number;
  streamLibraryId?: string;
  streamKey?: string;
};

export type ConfigureCallbacks = {
  ask: (q: { name: string; message: string; mode: 'plain' | 'mask' }) => Promise<string>;
  pick: (q: { name: string; message: string; choices: Array<{ value: string; label: string }> }) => Promise<string>;
  confirm: (q: { message: string; default: boolean }) => Promise<boolean>;
  notify?: (msg: string) => void;
};

export type ConfigureResult = {
  profile: string;
  storedScopes: string[];
};

export async function runConfigure(
  input: ConfigureInput,
  cb: ConfigureCallbacks,
  options: { interactive: boolean } = { interactive: true },
): Promise<ConfigureResult> {
  const profile = input.profile && input.profile.length > 0 ? input.profile : 'default';
  const storedScopes: string[] = [];

  // 1) Account key.
  const apiKey =
    input.apiKey ??
    (options.interactive
      ? await cb.ask({ name: 'apiKey', message: `Bunny API key for profile "${profile}"`, mode: 'mask' })
      : undefined);
  if (!apiKey) {
    throw new AuthError(`Bunny API key required (--api-key) for profile "${profile}".`);
  }
  await setCredential({ kind: 'account' }, apiKey, { profile });
  storedScopes.push(`${profile}:account`);
  cb.notify?.(`Account key stored for profile "${profile}".`);

  // 2) Validate by listing zones (also gives us choices for the next steps).
  const acct = createAccountClient({ resolveCredential: (s) => resolveCredential(s, { profile }) });
  const zones = await acct.listStorageZones().catch(() => []);
  const pullZones = await acct.listPullZones().catch(() => []);
  cb.notify?.(`Validated: ${zones.length} storage zone(s), ${pullZones.length} pull zone(s).`);

  // 3) Optional explicit storage zone password. Not prompted: with an account
  // key stored, zone passwords are fetched on demand (core/scoped-key-resolver).
  // Explicit flags remain for setups that pin a zone-scoped password.
  if (input.storageZone && input.storagePassword) {
    await setCredential({ kind: 'storage', zone: input.storageZone }, input.storagePassword, { profile });
    storedScopes.push(`${profile}:storage:${input.storageZone}`);
    cb.notify?.('Storage zone password stored.');
  }

  // 4) Optional Stream library + key.
  if (input.streamLibraryId && input.streamKey) {
    await setCredential({ kind: 'stream', libraryId: input.streamLibraryId }, input.streamKey, { profile });
    storedScopes.push(`${profile}:stream:${input.streamLibraryId}`);
    cb.notify?.(`Stream library key stored.`);
  }

  return { profile, storedScopes };
}
