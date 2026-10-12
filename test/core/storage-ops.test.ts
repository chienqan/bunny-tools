import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deletePath, listPath, listZones, parseStorageTarget } from '../../src/core/storage-ops.js';
import { _resetDerivedKeys } from '../../src/core/scoped-key-resolver.js';
import { getMockAgent } from '../setup.js';

const ZONE = {
  Id: 1,
  Name: 'my-zone',
  Region: 'SG',
  StorageUsed: 10,
  FilesStored: 2,
  ReplicationRegions: [],
  PullZones: [],
  Password: 'zone-secret',
  ReadOnlyPassword: 'zone-ro-secret',
};

// Header matcher that ignores header-name casing.
function withAccessKey(value: string) {
  return (headers: Record<string, string>) =>
    Object.entries(headers).some(([k, v]) => k.toLowerCase() === 'accesskey' && v === value);
}

describe('parseStorageTarget', () => {
  it('bare zone means the zone root, as a directory', () => {
    expect(parseStorageTarget('my-zone')).toEqual({ zone: 'my-zone', path: '/', isDir: true });
  });

  it('splits zone and path', () => {
    expect(parseStorageTarget('my-zone/img/logo.png')).toEqual({ zone: 'my-zone', path: '/img/logo.png', isDir: false });
  });

  it('trailing slash marks a directory', () => {
    expect(parseStorageTarget('my-zone/img/')).toEqual({ zone: 'my-zone', path: '/img/', isDir: true });
  });

  it('tolerates a leading slash and doubled slashes', () => {
    expect(parseStorageTarget('/my-zone//a//b.txt')).toEqual({ zone: 'my-zone', path: '/a/b.txt', isDir: false });
  });

  it.each(['my-zone/.', 'my-zone/a/..', 'my-zone/./x', '../my-zone'])('rejects dot segments: %s', (raw) => {
    expect(() => parseStorageTarget(raw)).toThrowError(/"\." or "\.\." segments/);
  });

  it.each(['my-zone/#', 'my-zone/img/#draft.png', 'my-zone/a?.png', 'my-zone\\a'])(
    'rejects characters URL parsing would reinterpret: %s',
    (raw) => {
      expect(() => parseStorageTarget(raw)).toThrowError(/cannot contain/);
    },
  );

  it('rejects an empty target with a hint', () => {
    expect(() => parseStorageTarget('  ')).toThrowError(/bunny storage ls/);
  });
});

describe('storage ops with only an account key', () => {
  let scratch: string;
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'storage-ops-'));
    for (const k of ['XDG_CONFIG_HOME', 'BUNNY_API_KEY', 'BUNNY_STORAGE_PASSWORD', 'BUNNY_STORAGE_PASSWORD_MY_ZONE']) {
      envBackup[k] = process.env[k];
      delete process.env[k];
    }
    process.env['XDG_CONFIG_HOME'] = scratch;
    process.env['BUNNY_API_KEY'] = 'account-key';
    _resetDerivedKeys();
  });

  afterEach(async () => {
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await rm(scratch, { recursive: true, force: true });
  });

  it('listZones strips zone passwords', async () => {
    getMockAgent()
      .get('https://api.bunny.net')
      .intercept({ path: /\/storagezone.*/, method: 'GET' })
      .reply(200, { Items: [ZONE], HasMoreItems: false });
    const zones = await listZones();
    expect(zones).toHaveLength(1);
    expect(zones[0]).not.toHaveProperty('Password');
    expect(zones[0]).not.toHaveProperty('ReadOnlyPassword');
  });

  it('listPath uses the zone password fetched with the account key', async () => {
    const agent = getMockAgent();
    agent
      .get('https://api.bunny.net')
      .intercept({ path: /\/storagezone.*/, method: 'GET' })
      .reply(200, { Items: [ZONE], HasMoreItems: false });
    agent
      .get('https://sg.storage.bunnycdn.com')
      .intercept({ path: '/my-zone/img/', method: 'GET', headers: withAccessKey('zone-secret') })
      .reply(200, [
        { Guid: 'g', ObjectName: 'logo.png', Path: '/my-zone/img/', Length: 5, IsDirectory: false, LastChanged: '' },
      ]);
    const entries = await listPath(parseStorageTarget('my-zone/img'));
    expect(entries).toEqual([{ path: 'logo.png', size: 5, isDirectory: false }]);
  });

  it('an explicitly stored zone password wins over the fetched one', async () => {
    process.env['BUNNY_STORAGE_PASSWORD_MY_ZONE'] = 'pinned-secret';
    const agent = getMockAgent();
    agent
      .get('https://api.bunny.net')
      .intercept({ path: /\/storagezone.*/, method: 'GET' })
      .reply(200, { Items: [ZONE], HasMoreItems: false });
    agent
      .get('https://sg.storage.bunnycdn.com')
      .intercept({ path: '/my-zone/', method: 'GET', headers: withAccessKey('pinned-secret') })
      .reply(200, []);
    expect(await listPath(parseStorageTarget('my-zone'))).toEqual([]);
  });

  it('unknown zone names point at `bunny storage ls`', async () => {
    getMockAgent()
      .get('https://api.bunny.net')
      .intercept({ path: /\/storagezone.*/, method: 'GET' })
      .reply(200, { Items: [], HasMoreItems: false });
    await expect(listPath(parseStorageTarget('nope/x'))).rejects.toThrowError(/bunny storage ls/);
  });

  it('refuses to delete a zone root', async () => {
    await expect(deletePath(parseStorageTarget('my-zone'))).rejects.toThrowError(/storage zone delete/);
  });

  it('refuses a plain delete of a trailing-slash directory without -r', async () => {
    getMockAgent()
      .get('https://api.bunny.net')
      .intercept({ path: /\/storagezone.*/, method: 'GET' })
      .reply(200, { Items: [ZONE], HasMoreItems: false });
    await expect(deletePath(parseStorageTarget('my-zone/img/'))).rejects.toThrowError(/Pass -r/);
  });

  it('refuses a plain delete when the path is a directory in its parent listing', async () => {
    const agent = getMockAgent();
    agent
      .get('https://api.bunny.net')
      .intercept({ path: /\/storagezone.*/, method: 'GET' })
      .reply(200, { Items: [ZONE], HasMoreItems: false });
    agent
      .get('https://sg.storage.bunnycdn.com')
      .intercept({ path: '/my-zone/', method: 'GET' })
      .reply(200, [{ Guid: 'g', ObjectName: 'img', Path: '/my-zone/', Length: 0, IsDirectory: true, LastChanged: '' }]);
    await expect(deletePath(parseStorageTarget('my-zone/img'))).rejects.toThrowError(/is a directory/);
  });

  it('deletes a single file after confirming it is not a directory', async () => {
    const agent = getMockAgent();
    agent
      .get('https://api.bunny.net')
      .intercept({ path: /\/storagezone.*/, method: 'GET' })
      .reply(200, { Items: [ZONE], HasMoreItems: false });
    const storage = agent.get('https://sg.storage.bunnycdn.com');
    storage
      .intercept({ path: '/my-zone/img/', method: 'GET' })
      .reply(200, [{ Guid: 'g', ObjectName: 'a b.png', Path: '/my-zone/img/', Length: 3, IsDirectory: false, LastChanged: '' }]);
    storage.intercept({ path: '/my-zone/img/a%20b.png', method: 'DELETE' }).reply(200, '');
    expect(await deletePath(parseStorageTarget('my-zone/img/a b.png'))).toBe(1);
  });

  it('rejects a region that is not a plain region code', async () => {
    await expect(listPath(parseStorageTarget('my-zone'), { region: 'evil.example/' })).rejects.toThrowError(/Invalid storage region/);
  });

  it('a generic BUNNY_STORAGE_PASSWORD does not override the fetched zone password', async () => {
    process.env['BUNNY_STORAGE_PASSWORD'] = 'other-zone-secret';
    const agent = getMockAgent();
    agent
      .get('https://api.bunny.net')
      .intercept({ path: /\/storagezone.*/, method: 'GET' })
      .reply(200, { Items: [ZONE], HasMoreItems: false });
    agent
      .get('https://sg.storage.bunnycdn.com')
      .intercept({ path: '/my-zone/', method: 'GET', headers: withAccessKey('zone-secret') })
      .reply(200, []);
    expect(await listPath(parseStorageTarget('my-zone'))).toEqual([]);
  });

  it('falls back to the generic BUNNY_STORAGE_PASSWORD when the zone password cannot be fetched', async () => {
    // CI shape: a zone-scoped password but no usable account key. The account
    // lookup answering 401 stands in for "no account key" without depending on
    // whatever is in the developer's OS keychain.
    process.env['BUNNY_STORAGE_PASSWORD'] = 'ci-secret';
    const agent = getMockAgent();
    agent
      .get('https://api.bunny.net')
      .intercept({ path: /\/storagezone.*/, method: 'GET' })
      .reply(401, { Message: 'Unauthorized' });
    agent
      .get('https://sg.storage.bunnycdn.com')
      .intercept({ path: '/my-zone/', method: 'GET', headers: withAccessKey('ci-secret') })
      .reply(200, []);
    expect(await listPath(parseStorageTarget('my-zone'), { region: 'sg' })).toEqual([]);
  });
});

describe('Stream library key fallback', () => {
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ['BUNNY_API_KEY', 'BUNNY_STREAM_KEY', 'BUNNY_STREAM_KEY_77']) {
      envBackup[k] = process.env[k];
      delete process.env[k];
    }
    process.env['BUNNY_API_KEY'] = 'account-key';
    _resetDerivedKeys();
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('fetches the library API key with the account key', async () => {
    const { listVideos } = await import('../../src/core/stream.js');
    const agent = getMockAgent();
    agent
      .get('https://api.bunny.net')
      .intercept({ path: '/videolibrary/77', method: 'GET' })
      .reply(200, { Id: 77, Name: 'lib', ApiKey: 'lib-secret' });
    agent
      .get('https://video.bunnycdn.com')
      .intercept({ path: /\/library\/77\/videos.*/, method: 'GET', headers: withAccessKey('lib-secret') })
      .reply(200, { items: [], totalItems: 0 });
    expect(await listVideos(77)).toEqual([]);
  });
});
