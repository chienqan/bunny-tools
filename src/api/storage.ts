// Edge Storage API client. Regional endpoint resolved per zone.
// Auth: storage zone password (scope = `storage:<zone>`).

import type { CredentialResolver } from './http.js';
import { createHttpClient } from './http.js';
import { storageBaseUrl } from './account.js';

export type StorageEntry = {
  Guid: string;
  ObjectName: string;
  Path: string;
  Length: number;
  IsDirectory: boolean;
  LastChanged: string;
  // ETag/Checksum may or may not be present depending on API. Bunny exposes
  // a `Checksum` field on directory listings - sha256 of the file. We use it for
  // diff when present; SHA256 of local file is the source of truth otherwise.
  Checksum?: string;
};

// Percent-encode each path segment so `?`, `#`, `%` and spaces stay part of the
// file name. Dot segments are refused outright: URL parsing would resolve them
// (even as %2e) and retarget the request at a parent directory.
function encodeSegments(path: string): string {
  if (path.length === 0) return '';
  return path
    .split('/')
    .map((seg) => {
      if (seg === '.' || seg === '..') throw new Error(`Refusing storage path with "${seg}" segment: ${path}`);
      return encodeURIComponent(seg);
    })
    .join('/');
}

export type StorageClientOptions = {
  resolveCredential: CredentialResolver;
};

export function createStorageClient(opts: StorageClientOptions) {
  const { callBunny } = createHttpClient({ resolveCredential: opts.resolveCredential });

  function joinPath(zone: string, path: string): string {
    const clean = path.replace(/^\/+|\/+$/g, '');
    return `/${encodeSegments(zone)}/${encodeSegments(clean)}`;
  }

  return {
    putFile: async (
      zone: string,
      region: string,
      path: string,
      body: Buffer,
      contentType?: string,
    ): Promise<void> => {
      await callBunny<void>({
        base: storageBaseUrl(region),
        path: joinPath(zone, path),
        method: 'PUT',
        scope: { kind: 'storage', zone },
        body,
        contentType: contentType ?? 'application/octet-stream',
      });
    },

    getFile: async (zone: string, region: string, path: string): Promise<Buffer> => {
      return callBunny<Buffer>({
        base: storageBaseUrl(region),
        path: joinPath(zone, path),
        scope: { kind: 'storage', zone },
        binary: true,
      });
    },

    deleteFile: async (zone: string, region: string, path: string): Promise<void> => {
      await callBunny<void>({
        base: storageBaseUrl(region),
        path: joinPath(zone, path),
        method: 'DELETE',
        scope: { kind: 'storage', zone },
      });
    },

    listDir: async (zone: string, region: string, path: string): Promise<StorageEntry[]> => {
      // Bunny Edge Storage requires a trailing slash to list a directory; without
      // it, the endpoint treats the path as a file lookup and returns 404. We
      // bypass `joinPath` (which strips trailing slashes for file ops) and build
      // the directory URL explicitly. Default `/` resolves to the zone root.
      const safePath = typeof path === 'string' && path.length > 0 ? path : '/';
      const cleanDir = safePath.replace(/^\/+/, '').replace(/\/+$/, '');
      const dirPath = cleanDir.length > 0 ? `/${encodeSegments(zone)}/${encodeSegments(cleanDir)}/` : `/${encodeSegments(zone)}/`;
      const result = await callBunny<StorageEntry[] | null>({
        base: storageBaseUrl(region),
        path: dirPath,
        scope: { kind: 'storage', zone },
      });
      return result ?? [];
    },
  };
}

export type StorageClient = ReturnType<typeof createStorageClient>;

// Recursive listing - flattens directory tree into a single array of files
// (no directories). Used by deploy diff + `storage ls -r`.
export async function listRecursive(
  client: StorageClient,
  zone: string,
  region: string,
  root = '/',
): Promise<Array<{ path: string; length: number; lastChanged: string; checksum?: string }>> {
  const queue: string[] = [root];
  const out: Array<{ path: string; length: number; lastChanged: string; checksum?: string }> = [];
  while (queue.length > 0) {
    const dir = queue.shift()!;
    const entries = await client.listDir(zone, region, dir);
    for (const e of entries) {
      const fullPath = (e.Path ?? '').replace(new RegExp(`^/${zone}`), '') + e.ObjectName;
      const normalized = fullPath.replace(/^\/+/, '');
      if (e.IsDirectory) {
        queue.push(`/${normalized}/`);
      } else {
        out.push({
          path: normalized,
          length: e.Length,
          lastChanged: e.LastChanged,
          ...(e.Checksum ? { checksum: e.Checksum } : {}),
        });
      }
    }
  }
  return out;
}
