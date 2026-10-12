import { describe, expect, it } from 'vitest';
import { createStorageClient, listRecursive } from '../../src/api/storage.js';
import { getMockAgent } from '../setup.js';

const STORAGE_HOST = 'https://storage.bunncdn.test';
// Match storageBaseUrl('de') shape: `https://storage.bunnycdn.com` (region 'de' is empty subdomain in prod).
// In tests we use the real prod URL — MockAgent intercepts undici globally.
const PROD_HOST = 'https://storage.bunnycdn.com';

function buildClient() {
  return createStorageClient({ resolveCredential: async () => 'test-storage-pw' });
}

describe('createStorageClient.listDir', () => {
  it('hits /<zone>/ for the root path', async () => {
    getMockAgent()
      .get(PROD_HOST)
      .intercept({ path: '/myzone/', method: 'GET' })
      .reply(200, []);
    const client = buildClient();
    const out = await client.listDir('myzone', '', '/');
    expect(out).toEqual([]);
  });

  it('hits /<zone>/sub/ for a non-root subdirectory (no trailing slash in input)', async () => {
    getMockAgent()
      .get(PROD_HOST)
      .intercept({ path: '/myzone/assets/', method: 'GET' })
      .reply(200, [{ ObjectName: 'a.png', Length: 10, IsDirectory: false }]);
    const client = buildClient();
    const out = await client.listDir('myzone', '', '/assets');
    expect(out).toHaveLength(1);
  });

  it('preserves trailing slash when the caller already provided one', async () => {
    getMockAgent()
      .get(PROD_HOST)
      .intercept({ path: '/myzone/assets/', method: 'GET' })
      .reply(200, []);
    const client = buildClient();
    const out = await client.listDir('myzone', '', '/assets/');
    expect(out).toEqual([]);
  });

  it('handles deeply nested paths', async () => {
    getMockAgent()
      .get(PROD_HOST)
      .intercept({ path: '/myzone/a/b/c/', method: 'GET' })
      .reply(200, []);
    const client = buildClient();
    const out = await client.listDir('myzone', '', '/a/b/c');
    expect(out).toEqual([]);
  });

  it('treats undefined-shaped path as root rather than throwing', async () => {
    getMockAgent()
      .get(PROD_HOST)
      .intercept({ path: '/myzone/', method: 'GET' })
      .reply(200, []);
    const client = buildClient();
    // Bug #2 surfaced when callers passed a non-string — the listDir guard now
    // falls back to '/' so the request still succeeds.
    const out = await client.listDir('myzone', '', undefined as unknown as string);
    expect(out).toEqual([]);
  });
});

describe('createStorageClient path encoding', () => {
  it('percent-encodes each segment so # ? % stay in the file name', async () => {
    getMockAgent()
      .get(PROD_HOST)
      .intercept({ path: '/myzone/a%23b%3F%25.txt', method: 'DELETE' })
      .reply(200, '');
    await expect(buildClient().deleteFile('myzone', '', '/a#b?%.txt')).resolves.toBeUndefined();
  });

  it('refuses dot segments that URL parsing would resolve to a parent', async () => {
    await expect(buildClient().deleteFile('myzone', '', '/a/..')).rejects.toThrowError(/segment/);
    await expect(buildClient().listDir('myzone', '', '/..')).rejects.toThrowError(/segment/);
  });
});

describe('listRecursive', () => {
  it('walks subdirectories into a flat file list', async () => {
    const pool = getMockAgent().get(PROD_HOST);
    pool
      .intercept({ path: '/myzone/', method: 'GET' })
      .reply(200, [
        { ObjectName: 'index.html', Length: 100, IsDirectory: false, Path: '/myzone/' },
        { ObjectName: 'sub', Length: 0, IsDirectory: true, Path: '/myzone/' },
      ]);
    pool
      .intercept({ path: '/myzone/sub/', method: 'GET' })
      .reply(200, [
        { ObjectName: 'app.js', Length: 200, IsDirectory: false, Path: '/myzone/sub/' },
      ]);

    const client = buildClient();
    const out = await listRecursive(client, 'myzone', '', '/');
    const paths = out.map((e) => e.path).sort();
    expect(paths).toEqual(['index.html', 'sub/app.js']);
  });
});

// `STORAGE_HOST` reserved for future regional-host coverage.
void STORAGE_HOST;
