import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { resolvePurgeTargets, runPurge } from '../../src/core/purge.js';
import { getMockAgent } from '../setup.js';
import type { AccountClient } from '../../src/api/account.js';

function fakeClient(overrides: Partial<AccountClient> = {}): AccountClient {
  return {
    listStorageZones: vi.fn(),
    getStorageZoneByName: vi.fn(),
    getStorageZone: vi.fn(),
    createStorageZone: vi.fn(),
    deleteStorageZone: vi.fn(),
    listPullZones: vi.fn(),
    getPullZone: vi.fn(),
    createPullZone: vi.fn(),
    deletePullZone: vi.fn(),
    purgeByUrl: vi.fn(async () => undefined),
    purgePullZone: vi.fn(async () => undefined),
    purgePullZoneByTag: vi.fn(async () => undefined),
    ...overrides,
  } as AccountClient;
}

describe('resolvePurgeTargets', () => {
  it('maps URLs to url targets', async () => {
    expect(await resolvePurgeTargets({ urls: ['https://cdn.example.com/x.js'] })).toEqual([
      { kind: 'url', url: 'https://cdn.example.com/x.js' },
    ]);
  });

  it('a numeric pull zone id needs no lookup', async () => {
    expect(await resolvePurgeTargets({ pullZone: 42 })).toEqual([{ kind: 'pullzone', pullZoneId: 42 }]);
  });

  it('pull zone + tag becomes a tag purge', async () => {
    expect(await resolvePurgeTargets({ pullZone: 42, tag: 'app' })).toEqual([
      { kind: 'tag', pullZoneId: 42, tag: 'app' },
    ]);
  });

  it('resolves a pull zone by name', async () => {
    const prev = process.env['BUNNY_API_KEY'];
    process.env['BUNNY_API_KEY'] = 'test-key';
    onTestFinished(() => {
      if (prev === undefined) delete process.env['BUNNY_API_KEY'];
      else process.env['BUNNY_API_KEY'] = prev;
    });
    getMockAgent()
      .get('https://api.bunny.net')
      .intercept({ path: /\/pullzone.*/, method: 'GET' })
      .reply(200, { Items: [{ Id: 7, Name: 'my-site', OriginUrl: null, Enabled: true, Hostnames: [] }], HasMoreItems: false });
    expect(await resolvePurgeTargets({ pullZone: 'my-site' })).toEqual([{ kind: 'pullzone', pullZoneId: 7 }]);
  });

  it('rejects non-URL positional targets with a hint', async () => {
    await expect(resolvePurgeTargets({ urls: ['pullzone:42'] })).rejects.toThrowError(/--pull-zone/);
  });

  it('rejects --tag without --pull-zone', async () => {
    await expect(resolvePurgeTargets({ tag: 'app' })).rejects.toThrowError(/--pull-zone/);
  });

  it('returns no targets for an empty request (caller falls back to bunny.json)', async () => {
    expect(await resolvePurgeTargets({})).toEqual([]);
  });
});

describe('runPurge', () => {
  it('purges a URL', async () => {
    const client = fakeClient();
    const r = await runPurge(client, { kind: 'url', url: 'https://x.test' });
    expect(r.ok).toBe(1);
    expect(r.failed).toEqual([]);
    expect(client.purgeByUrl).toHaveBeenCalledWith('https://x.test');
  });

  it('purges a pull-zone', async () => {
    const client = fakeClient();
    const r = await runPurge(client, { kind: 'pullzone', pullZoneId: 99 });
    expect(r.ok).toBe(1);
    expect(client.purgePullZone).toHaveBeenCalledWith(99);
  });

  it('collects failures', async () => {
    const client = fakeClient({
      purgePullZone: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    const r = await runPurge(client, { kind: 'pullzone', pullZoneId: 7 });
    expect(r.ok).toBe(0);
    expect(r.failed).toEqual([{ target: 'pull-zone:7', error: 'boom' }]);
  });
});
