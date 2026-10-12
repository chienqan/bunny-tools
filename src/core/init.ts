// core/init - unified bootstrap. Replaces the old configure + init split.
// One entrypoint that handles auth (skipped if creds exist), feature multi-select,
// and per-feature project config. UI-free: callers inject prompts callbacks.

import { existsSync } from 'node:fs';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWriteJson } from '../util/fs.js';
import { resolveCredential, setCredential, maskCredential } from '../config/credential-resolver.js';
import { createAccountClient } from '../api/account.js';
import { AuthError } from '../api/errors.js';
import type { StorageZone, PullZone } from '../api/account.js';
import { RC33_DEFAULT_IGNORE } from './ignore-migration.js';

export const FEATURES = ['storage', 'dns', 'stream', 'containers', 'scripting'] as const;
export type Feature = (typeof FEATURES)[number];

export const FEATURE_LABELS: Record<Feature, string> = {
  storage: 'Storage + CDN deploy   (recommended - the daily-deploy loop)',
  dns: 'DNS records management',
  stream: 'Stream (video library)',
  containers: 'Magic Containers',
  scripting: 'Edge Scripting',
};

export type InitInput = {
  // Auth
  apiKey?: string;
  // Feature selection (defaults to ['storage'] in non-interactive)
  features?: Feature[];
  // Storage+CDN config
  publicDir?: string;
  storageZone?: string;
  storagePassword?: string;
  region?: string;
  pullZoneId?: number;
  purge?: 'all' | 'none' | string;
  // Stream
  streamLibraryId?: string;
  streamKey?: string;
};

export type InitCallbacks = {
  ask: (q: { name: string; message: string; mode: 'plain' | 'mask' }) => Promise<string>;
  pick: (q: { name: string; message: string; choices: Array<{ value: string; label: string }> }) => Promise<string>;
  multiselect: (q: {
    name: string;
    message: string;
    choices: Array<{ value: Feature; label: string; selected?: boolean }>;
    min?: number;
  }) => Promise<Feature[]>;
  confirm: (q: { message: string; default: boolean }) => Promise<boolean>;
  notify?: (msg: string) => void;
};

export type InitResult = {
  bunnyJsonPath: string;
  storedScopes: string[];
  features: Feature[];
  gitignoreUpdated: boolean;
  alreadyInitialized: boolean;
};

export async function runInit(
  input: InitInput,
  cb: InitCallbacks,
  opts: { interactive: boolean; cwd?: string; force?: boolean } = { interactive: true },
): Promise<InitResult> {
  const cwd = opts.cwd ?? process.cwd();
  const bunnyJsonPath = join(cwd, 'bunny.json');

  if (existsSync(bunnyJsonPath) && !opts.force) {
    return {
      bunnyJsonPath,
      storedScopes: [],
      features: [],
      gitignoreUpdated: false,
      alreadyInitialized: true,
    };
  }

  // Step 1 - Auth (skipped if creds already resolvable).
  const storedScopes: string[] = [];
  const accountAlreadySet = await hasAccountCredential();
  if (!accountAlreadySet) {
    const key =
      input.apiKey ??
      (opts.interactive
        ? await cb.ask({ name: 'apiKey', message: 'Bunny API key', mode: 'mask' })
        : undefined);
    if (!key) throw new AuthError('Bunny API key required (--api-key or interactive prompt).');
    await setCredential({ kind: 'account' }, key);
    storedScopes.push('account');
    cb.notify?.('Account key stored.');
  } else {
    // Print masked key so user can verify which credential is in scope without
    // having to grep keychain or env separately.
    let masked = '****';
    try {
      masked = maskCredential(await resolveCredential({ kind: 'account' }));
    } catch {
      // resolver already returned true above; reading again can fail (race).
    }
    cb.notify?.(`Account key already configured (${masked}). Skipping auth step.`);
  }

  // Validate by listing zones - also gives us the lists for the next step.
  const acct = createAccountClient({ resolveCredential });
  const [zones, pullZones] = await Promise.all([
    acct.listStorageZones().catch(() => [] as StorageZone[]),
    acct.listPullZones().catch(() => [] as PullZone[]),
  ]);
  cb.notify?.(`Found ${zones.length} storage zone(s), ${pullZones.length} pull zone(s).`);

  // Step 2 - Feature picker (skipped if features pre-supplied).
  let features = input.features ?? (opts.interactive ? null : (['storage'] as Feature[]));
  if (features === null) {
    features = await cb.multiselect({
      name: 'features',
      message: 'What features will this project use?',
      choices: FEATURES.map((f) => ({
        value: f,
        label: FEATURE_LABELS[f],
        selected: f === 'storage',
      })),
      min: 1,
    });
  }
  if (features.length === 0) {
    throw new Error('At least one feature must be selected.');
  }

  // Step 3 - Per-feature config. Builds the bunny.json deploy block.
  const config: Record<string, unknown> = {
    $schema: 'https://unpkg.com/bunny-tools/schema/bunny.schema.json',
  };

  if (features.includes('storage')) {
    const storage = await configureStorage(input, cb, zones, pullZones, opts.interactive);
    config['deploy'] = storage.deploy;
    if (storage.passwordStored) storedScopes.push(`storage:${storage.deploy.storageZone}`);
  }

  if (features.includes('stream')) {
    if (input.streamLibraryId && input.streamKey) {
      await setCredential({ kind: 'stream', libraryId: input.streamLibraryId }, input.streamKey);
      storedScopes.push(`stream:${input.streamLibraryId}`);
      cb.notify?.(`Stream library key stored for library ${input.streamLibraryId}.`);
    } else {
      cb.notify?.(
        'Stream selected - library keys are fetched with your API key; manage videos via `bunny stream video ...`.',
      );
    }
  }

  if (features.includes('dns')) {
    cb.notify?.('DNS selected - manage records via `bunny dns record ...`. No project config needed.');
  }
  if (features.includes('containers')) {
    cb.notify?.('Magic Containers selected - manage via `bunny containers ...`. No project config needed.');
  }
  if (features.includes('scripting')) {
    cb.notify?.('Edge Scripting selected - manage via `bunny scripting ...`. No project config needed.');
  }

  // Step 4 - Write artifacts.
  await atomicWriteJson(bunnyJsonPath, config);
  const gitignoreUpdated = await maybeUpdateGitignore(cwd);

  return {
    bunnyJsonPath,
    storedScopes,
    features,
    gitignoreUpdated,
    alreadyInitialized: false,
  };
}

async function hasAccountCredential(): Promise<boolean> {
  try {
    const key = await resolveCredential({ kind: 'account' });
    return key.length > 0;
  } catch {
    return false;
  }
}

async function configureStorage(
  input: InitInput,
  cb: InitCallbacks,
  zones: StorageZone[],
  pullZones: PullZone[],
  interactive: boolean,
): Promise<{
  deploy: {
    publicDir: string;
    ignore: string[];
    storageZone: string;
    region?: string;
    concurrency: number;
    pullZones: Array<{ id: number; purge: string }>;
  };
  passwordStored: boolean;
}> {
  const detectedPublicDir = detectPublicDir(input.publicDir);
  const publicDir = input.publicDir ?? (interactive ? await pickOrAsk(cb, 'publicDir', 'Public directory', detectedPublicDir) : detectedPublicDir);

  let storageZone = input.storageZone;
  if (!storageZone) {
    if (!interactive) throw new Error('--storage-zone required in non-interactive mode for `storage` feature.');
    if (zones.length > 0) {
      storageZone = await cb.pick({
        name: 'storageZone',
        message: 'Storage zone',
        choices: zones.map((z) => ({
          value: z.Name,
          label: `${z.Name} (region=${z.Region}, files=${z.FilesStored})`,
        })),
      });
    } else {
      storageZone = await cb.ask({
        name: 'storageZone',
        message: 'Storage zone name (no zones found on account; you can create one later)',
        mode: 'plain',
      });
    }
  }

  let passwordStored = false;
  // No prompt: the zone password is fetched with the account key at deploy time.
  // An explicit --storage-password is still stored (e.g. CI without an account key).
  const password = input.storagePassword;
  if (password) {
    await setCredential({ kind: 'storage', zone: storageZone }, password);
    passwordStored = true;
    cb.notify?.(`Storage zone password stored.`);
  }

  let pullZoneId = input.pullZoneId;
  if (pullZoneId === undefined && interactive && pullZones.length > 0) {
    const choice = await cb.pick({
      name: 'pullZone',
      message: 'Pull zone for CDN (or pick "none")',
      choices: [
        ...pullZones.map((p) => ({ value: String(p.Id), label: `${p.Name} (id=${p.Id})` })),
        { value: '', label: 'none - skip CDN purge' },
      ],
    });
    if (choice.length > 0) pullZoneId = Number.parseInt(choice, 10);
  }

  let purge = input.purge;
  if (!purge && interactive && pullZoneId !== undefined) {
    purge = await cb.pick({
      name: 'purge',
      message: 'Purge strategy after deploy',
      choices: [
        { value: 'all', label: 'all - full pull-zone purge' },
        { value: 'tag:app', label: 'tag - Cache-Tag based (origin must set Cache-Tag header)' },
        { value: 'none', label: 'none - skip purge' },
      ],
    });
  }
  purge = purge ?? 'all';

  return {
    deploy: {
      publicDir,
      ignore: [...RC33_DEFAULT_IGNORE],
      storageZone,
      ...(input.region ? { region: input.region } : {}),
      concurrency: 8,
      pullZones: pullZoneId !== undefined ? [{ id: pullZoneId, purge }] : [],
    },
    passwordStored,
  };
}

async function pickOrAsk(
  cb: InitCallbacks,
  name: string,
  message: string,
  defaultValue: string,
): Promise<string> {
  const v = await cb.ask({ name, message: `${message} (default: ${defaultValue})`, mode: 'plain' });
  return v.length > 0 ? v : defaultValue;
}

export function detectPublicDir(override?: string, cwd = process.cwd()): string {
  if (override) return override;
  for (const candidate of ['dist', 'build', 'out', 'public', '_site']) {
    if (existsSync(join(cwd, candidate))) return candidate;
  }
  return 'dist';
}

async function maybeUpdateGitignore(cwd: string): Promise<boolean> {
  const gitignore = join(cwd, '.gitignore');
  if (!existsSync(gitignore)) return false;
  const raw = await readFile(gitignore, 'utf8');
  if (raw.split(/\r?\n/).includes('.bunny-state.json')) return false;
  await appendFile(gitignore, `\n# bunny-tools\n.bunny-state.json\n`);
  return true;
}

// Helper for test fixtures.
export async function writeBunnyJson(path: string, body: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(body, null, 2), 'utf8');
}
