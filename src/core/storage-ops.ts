// core/storage-ops - file operations on a storage zone, addressed aws-s3 style
// as `<zone>/<path>`. Region and zone password are resolved once per command
// from the account API, so callers only need the account key.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, resolve as resolvePath } from 'node:path';
import { createAccountClient, regionCodeToSubdomain } from '../api/account.js';
import type { StorageZone } from '../api/account.js';
import { ConfigError, ValidationError } from '../api/errors.js';
import { createStorageClient, listRecursive } from '../api/storage.js';
import type { StorageClient } from '../api/storage.js';
import type { AuthScope } from '../api/http.js';
import { resolveCredential } from '../config/credential-resolver.js';
import { contentTypeFor } from '../util/content-type.js';
import { resolveScopedCredential } from './scoped-key-resolver.js';

// --- Addressing --------------------------------------------------------------

export type StorageTarget = {
  zone: string;
  // Always starts with `/`. `/` means the zone root.
  path: string;
  // True when the user wrote a trailing slash (`my-zone/img/`), i.e. "into this dir".
  isDir: boolean;
};

// Parse `my-zone`, `my-zone/`, `my-zone/a/b.txt`, `/my-zone/a/`. The first
// segment is always the zone name.
export function parseStorageTarget(raw: string): StorageTarget {
  const trimmed = raw.trim().replace(/^\/+/, '');
  if (trimmed.length === 0) {
    throw new ValidationError('Expected <zone>/<path>, e.g. `my-zone/assets/logo.png`. Run `bunny storage ls` to see zones.');
  }
  const slash = trimmed.indexOf('/');
  const zone = slash === -1 ? trimmed : trimmed.slice(0, slash);
  const rest = slash === -1 ? '' : trimmed.slice(slash + 1);
  const path = `/${rest.replace(/\/{2,}/g, '/').replace(/^\//, '')}`;
  return { zone, path, isDir: rest.length === 0 || rest.endsWith('/') };
}

// --- Zone handle -------------------------------------------------------------

type ZoneHandle = { zone: string; region: string; client: StorageClient };

function accountClient() {
  return createAccountClient({ resolveCredential: (s) => resolveCredential(s) });
}

// Strip zone passwords before anything reaches stdout / MCP results.
export type PublicStorageZone = Omit<StorageZone, 'Password' | 'ReadOnlyPassword'>;
export function toPublicZone(z: StorageZone): PublicStorageZone {
  const { Password: _p, ReadOnlyPassword: _r, ...rest } = z;
  return rest;
}

export async function listZones(): Promise<PublicStorageZone[]> {
  return (await accountClient().listStorageZones()).map(toPublicZone);
}

// Resolve region + credential for one zone. `region` skips the account lookup
// (useful in CI where only BUNNY_STORAGE_PASSWORD is set).
async function openZone(zone: string, region?: string): Promise<ZoneHandle> {
  let meta: StorageZone | undefined;
  if (region === undefined) {
    meta = await accountClient().getStorageZoneByName(zone);
    if (!meta) throw new ConfigError(`Storage zone "${zone}" not found on this account. Run \`bunny storage ls\` to see zones.`);
  }
  const knownPassword = meta?.Password;
  const resolver = async (scope: AuthScope): Promise<string> => {
    if (scope.kind === 'storage' && knownPassword) {
      // Stored scoped key still wins over the fetched one.
      return resolveCredential(scope).catch(() => knownPassword);
    }
    return resolveScopedCredential(scope);
  };
  return {
    zone,
    region: region ?? regionCodeToSubdomain(meta!.Region),
    client: createStorageClient({ resolveCredential: resolver }),
  };
}

// --- Operations --------------------------------------------------------------

export type ListedEntry = { path: string; size: number; isDirectory: boolean; checksum?: string };

export async function listPath(
  target: StorageTarget,
  opts: { recursive?: boolean; region?: string } = {},
): Promise<ListedEntry[]> {
  const h = await openZone(target.zone, opts.region);
  if (opts.recursive) {
    const items = await listRecursive(h.client, h.zone, h.region, target.path);
    return items.map((i) => ({ path: i.path, size: i.length, isDirectory: false, ...(i.checksum ? { checksum: i.checksum } : {}) }));
  }
  const entries = await h.client.listDir(h.zone, h.region, target.path);
  return entries.map((e) => ({
    path: (e.ObjectName ?? '').toString(),
    size: e.Length,
    isDirectory: e.IsDirectory,
    ...(e.Checksum ? { checksum: e.Checksum } : {}),
  }));
}

// Upload one file. A directory target (`zone/` or `zone/img/`) keeps the local file name.
export async function uploadFile(localPath: string, target: StorageTarget, opts: { region?: string } = {}): Promise<string> {
  const h = await openZone(target.zone, opts.region);
  const remote = target.isDir ? `${target.path.replace(/\/+$/, '')}/${basename(localPath)}` : target.path;
  const buf = await readFile(resolvePath(localPath));
  await h.client.putFile(h.zone, h.region, remote, buf, contentTypeFor(remote));
  return remote;
}

// Upload many files under one zone handle (one region/password lookup total).
export async function uploadMany(
  zone: string,
  files: Array<{ local: string; remote: string }>,
  opts: { region?: string } = {},
): Promise<Array<() => Promise<void>>> {
  const h = await openZone(zone, opts.region);
  return files.map((f) => async () => {
    const buf = await readFile(resolvePath(f.local));
    await h.client.putFile(h.zone, h.region, f.remote, buf, contentTypeFor(f.remote));
  });
}

// Download one file. `localPath` defaults to the remote file name in cwd;
// an existing-directory-style path (trailing slash) keeps the remote name.
export async function downloadFile(target: StorageTarget, localPath?: string, opts: { region?: string } = {}): Promise<string> {
  if (target.isDir) throw new ValidationError(`"${target.zone}${target.path}" is a directory; pass a file path.`);
  const h = await openZone(target.zone, opts.region);
  const name = basename(target.path);
  const dest = !localPath ? name : localPath.endsWith('/') ? `${localPath}${name}` : localPath;
  const buf = await h.client.getFile(h.zone, h.region, target.path);
  await mkdir(dirname(resolvePath(dest)), { recursive: true });
  await writeFile(resolvePath(dest), buf);
  return dest;
}

export async function deletePath(
  target: StorageTarget,
  opts: { recursive?: boolean; region?: string } = {},
): Promise<number> {
  if (target.path === '/') {
    throw new ValidationError('Refusing to delete a zone root. Use `bunny storage zone delete <zone>` to remove the zone.');
  }
  const h = await openZone(target.zone, opts.region);
  if (!opts.recursive) {
    await h.client.deleteFile(h.zone, h.region, target.path);
    return 1;
  }
  const items = await listRecursive(h.client, h.zone, h.region, target.path);
  for (const i of items) await h.client.deleteFile(h.zone, h.region, i.path);
  return items.length;
}
