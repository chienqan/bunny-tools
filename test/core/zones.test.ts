import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addEdgeRule,
  addPullZoneHostname,
  deleteEdgeRule,
  enablePullZoneSSL,
  listEdgeRules,
  listPullZoneHostnames,
  listStorageZones,
  removePullZoneHostname,
  updateStorageZone,
} from '../../src/core/zones.js';
import { getMockAgent } from '../setup.js';

describe('core/zones', () => {
  let scratch: string;
  let envBackup: Record<string, string | undefined> = {};

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'zones-'));
    envBackup['XDG_CONFIG_HOME'] = process.env['XDG_CONFIG_HOME'];
    envBackup['BUNNY_API_KEY'] = process.env['BUNNY_API_KEY'];
    process.env['XDG_CONFIG_HOME'] = scratch;
    process.env['BUNNY_API_KEY'] = 'test-key';
  });

  afterEach(async () => {
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    envBackup = {};
    await rm(scratch, { recursive: true, force: true });
  });

  it('listStorageZones returns the paginated list', async () => {
    getMockAgent()
      .get('https://api.bunny.net')
      .intercept({ path: /\/storagezone.*/, method: 'GET' })
      .reply(200, {
        Items: [
          { Id: 1, Name: 'a', Region: 'NY', StorageUsed: 0, FilesStored: 0, ReplicationRegions: [], PullZones: [] },
          { Id: 2, Name: 'b', Region: 'LA', StorageUsed: 0, FilesStored: 0, ReplicationRegions: [], PullZones: [] },
        ],
        HasMoreItems: false,
      });
    const zones = await listStorageZones();
    expect(zones).toHaveLength(2);
    expect(zones[0]?.Name).toBe('a');
  });

  it('updateStorageZone re-fetches after Bunny answers 204 and strips passwords', async () => {
    const pool = getMockAgent().get('https://api.bunny.net');
    pool.intercept({ path: '/storagezone/5', method: 'POST' }).reply(204, '');
    pool.intercept({ path: '/storagezone/5', method: 'GET' }).reply(200, {
      Id: 5, Name: 'z', Region: 'NY', StorageUsed: 0, FilesStored: 0, ReplicationRegions: ['LA'], PullZones: [], Password: 'secret',
    });
    const zone = await updateStorageZone(5, { ReplicationZones: ['LA'] });
    expect(zone.ReplicationRegions).toEqual(['LA']);
    expect(zone).not.toHaveProperty('Password');
  });

  it('addEdgeRule POSTs to /edgerules/addOrUpdate and re-lists', async () => {
    const pool = getMockAgent().get('https://api.bunny.net');
    pool
      .intercept({ path: '/pullzone/42/edgerules/addOrUpdate', method: 'POST' })
      .reply(200, { Guid: 'g2' });
    pool
      .intercept({ path: '/pullzone/42', method: 'GET' })
      .reply(200, {
        Id: 42,
        Name: 'pz',
        OriginUrl: 'https://x',
        Enabled: true,
        Hostnames: [],
        EdgeRules: [
          { Guid: 'g1', ActionType: 1 },
          { Guid: 'g2', ActionType: 2, Description: 'new' },
        ],
      });

    const next = await addEdgeRule(42, { ActionType: 2, Description: 'new' });
    expect(next).toHaveLength(2);
    expect(next[1]?.Description).toBe('new');
  });

  it('deleteEdgeRule DELETEs the subresource and re-lists', async () => {
    const pool = getMockAgent().get('https://api.bunny.net');
    pool
      .intercept({ path: '/pullzone/42/edgerules/g1', method: 'DELETE' })
      .reply(204);
    pool
      .intercept({ path: '/pullzone/42', method: 'GET' })
      .reply(200, {
        Id: 42,
        Name: 'pz',
        OriginUrl: 'https://x',
        Enabled: true,
        Hostnames: [],
        EdgeRules: [{ Guid: 'g2', ActionType: 2 }],
      });
    const next = await deleteEdgeRule(42, 'g1');
    expect(next).toHaveLength(1);
    expect(next[0]?.Guid).toBe('g2');
  });

  it('listEdgeRules returns empty for pull zones with no rules', async () => {
    getMockAgent()
      .get('https://api.bunny.net')
      .intercept({ path: '/pullzone/42', method: 'GET' })
      .reply(200, {
        Id: 42,
        Name: 'pz',
        OriginUrl: 'https://x',
        Enabled: true,
        Hostnames: [],
      });
    const rules = await listEdgeRules(42);
    expect(rules).toEqual([]);
  });

  it('addPullZoneHostname POSTs to /addHostname and re-lists hostnames', async () => {
    const pool = getMockAgent().get('https://api.bunny.net');
    pool
      .intercept({ path: '/pullzone/42/addHostname', method: 'POST' })
      .reply(204);
    pool
      .intercept({ path: '/pullzone/42', method: 'GET' })
      .reply(200, {
        Id: 42,
        Name: 'pz',
        OriginUrl: 'https://x',
        Enabled: true,
        Hostnames: [{ Value: 'example.com' }],
      });

    const hosts = await addPullZoneHostname(42, 'example.com');
    expect(hosts).toEqual(['example.com']);
  });

  it('removePullZoneHostname POSTs to /removeHostname and re-lists hostnames', async () => {
    const pool = getMockAgent().get('https://api.bunny.net');
    pool
      .intercept({ path: '/pullzone/42/removeHostname', method: 'DELETE' })
      .reply(204);
    pool
      .intercept({ path: '/pullzone/42', method: 'GET' })
      .reply(200, {
        Id: 42,
        Name: 'pz',
        OriginUrl: 'https://x',
        Enabled: true,
        Hostnames: [],
      });

    const hosts = await removePullZoneHostname(42, 'example.com');
    expect(hosts).toEqual([]);
  });

  it('enablePullZoneSSL POSTs loadFreeCertificate and polls until HasCertificate flips true', async () => {
    const pool = getMockAgent().get('https://api.bunny.net');
    // 1. Pre-flight getPullZone — hostname is linked but no cert yet.
    pool
      .intercept({ path: '/pullzone/42', method: 'GET' })
      .reply(200, {
        Id: 42,
        Name: 'pz',
        OriginUrl: 'https://x',
        Enabled: true,
        Hostnames: [{ Id: 1, Value: 'example.com', HasCertificate: false }],
      });
    // 2. loadFreeCertificate
    pool
      .intercept({ path: /\/pullzone\/loadFreeCertificate.*/, method: 'GET' })
      .reply(200, '');
    // 3. First poll — still no cert.
    pool
      .intercept({ path: '/pullzone/42', method: 'GET' })
      .reply(200, {
        Id: 42,
        Name: 'pz',
        OriginUrl: 'https://x',
        Enabled: true,
        Hostnames: [{ Id: 1, Value: 'example.com', HasCertificate: false }],
      });
    // 4. Second poll — cert ready.
    pool
      .intercept({ path: '/pullzone/42', method: 'GET' })
      .reply(200, {
        Id: 42,
        Name: 'pz',
        OriginUrl: 'https://x',
        Enabled: true,
        Hostnames: [{ Id: 1, Value: 'example.com', HasCertificate: true }],
      });

    const result = await enablePullZoneSSL(42, 'example.com', {
      timeoutMs: 5_000,
      pollIntervalMs: 10,
      noForceSSL: true,
    });
    expect(result.hasCertificate).toBe(true);
    expect(result.waitedMs).toBeGreaterThanOrEqual(0);
  });

  it('enablePullZoneSSL throws when hostname is not on the pull zone', async () => {
    getMockAgent()
      .get('https://api.bunny.net')
      .intercept({ path: '/pullzone/42', method: 'GET' })
      .reply(200, {
        Id: 42,
        Name: 'pz',
        OriginUrl: 'https://x',
        Enabled: true,
        Hostnames: [{ Id: 1, Value: 'other.com', HasCertificate: true }],
      });

    await expect(
      enablePullZoneSSL(42, 'example.com', { timeoutMs: 1_000, pollIntervalMs: 10 }),
    ).rejects.toThrow(/not linked to pull zone/);
  });

  it('enablePullZoneSSL returns immediately when cert + ForceSSL already set', async () => {
    getMockAgent()
      .get('https://api.bunny.net')
      .intercept({ path: '/pullzone/42', method: 'GET' })
      .reply(200, {
        Id: 42,
        Name: 'pz',
        OriginUrl: 'https://x',
        Enabled: true,
        // Both cert + ForceSSL already true → no API mutation, byte-equal envelope.
        Hostnames: [{ Id: 1, Value: 'example.com', HasCertificate: true, ForceSSL: true }],
      });

    const result = await enablePullZoneSSL(42, 'example.com', {
      timeoutMs: 1_000,
      pollIntervalMs: 10,
    });
    expect(result).toEqual({ hasCertificate: true, waitedMs: 0 });
  });

  it('enablePullZoneSSL flips ForceSSL=true when cert is already there but ForceSSL is off', async () => {
    const pool = getMockAgent().get('https://api.bunny.net');
    pool
      .intercept({ path: '/pullzone/42', method: 'GET' })
      .reply(200, {
        Id: 42,
        Name: 'pz',
        OriginUrl: 'https://x',
        Enabled: true,
        Hostnames: [{ Id: 1, Value: 'example.com', HasCertificate: true, ForceSSL: false }],
      });
    pool
      .intercept({ path: '/pullzone/42/setForceSSL', method: 'POST' })
      .reply(204);

    const result = await enablePullZoneSSL(42, 'example.com', { timeoutMs: 1_000, pollIntervalMs: 10 });
    expect(result.hasCertificate).toBe(true);
    expect(result.forceSslSet).toBe(true);
  });

  it('enablePullZoneSSL throws on timeout when cert never flips true', async () => {
    const pool = getMockAgent().get('https://api.bunny.net');
    const noCertPz = {
      Id: 42,
      Name: 'pz',
      OriginUrl: 'https://x',
      Enabled: true,
      Hostnames: [{ Id: 1, Value: 'example.com', HasCertificate: false }],
    };
    // 1 pre-flight + 3 polls before the timeout check fires (timeoutMs=30,
    // pollIntervalMs=10 → loop iterations 0/10/20 sleep+poll, iteration 30 throws).
    pool
      .intercept({ path: '/pullzone/42', method: 'GET' })
      .reply(200, noCertPz)
      .times(4);
    pool
      .intercept({ path: /\/pullzone\/loadFreeCertificate.*/, method: 'GET' })
      .reply(200, '');

    await expect(
      enablePullZoneSSL(42, 'example.com', { timeoutMs: 30, pollIntervalMs: 10 }),
    ).rejects.toThrow(/Timed out/);
  });

  it('listPullZoneHostnames extracts the Value field from each Hostname entry', async () => {
    getMockAgent()
      .get('https://api.bunny.net')
      .intercept({ path: '/pullzone/42', method: 'GET' })
      .reply(200, {
        Id: 42,
        Name: 'pz',
        OriginUrl: 'https://x',
        Enabled: true,
        Hostnames: [{ Value: 'a.com' }, { Value: 'b.com' }],
      });
    const hosts = await listPullZoneHostnames(42);
    expect(hosts).toEqual(['a.com', 'b.com']);
  });
});
