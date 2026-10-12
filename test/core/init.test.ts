import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runInit } from '../../src/core/init.js';
import { getMockAgent } from '../setup.js';

const ENV_KEY = 'BUNNY_API_KEY';

describe('runInit (unified bootstrap)', () => {
  let scratch: string;
  let envBackup: Record<string, string | undefined> = {};

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'init-'));
    envBackup['XDG_CONFIG_HOME'] = process.env['XDG_CONFIG_HOME'];
    envBackup[ENV_KEY] = process.env[ENV_KEY];
    process.env['XDG_CONFIG_HOME'] = scratch;
    delete process.env[ENV_KEY];
  });

  afterEach(async () => {
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    envBackup = {};
    await rm(scratch, { recursive: true, force: true });
  });

  function mockZoneListing(): void {
    const pool = getMockAgent().get('https://api.bunny.net');
    pool
      .intercept({ path: /\/storagezone.*/, method: 'GET' })
      .reply(200, {
        Items: [{ Id: 1, Name: 'my-app', Region: 'NY', StorageUsed: 0, FilesStored: 0, ReplicationRegions: [], PullZones: [] }],
        HasMoreItems: false,
      })
      .persist();
    pool
      .intercept({ path: /\/pullzone.*/, method: 'GET' })
      .reply(200, { Items: [], HasMoreItems: false })
      .persist();
  }

  function spies() {
    return {
      ask: vi.fn(),
      pick: vi.fn(),
      multiselect: vi.fn(),
      confirm: vi.fn(),
    };
  }

  it('non-interactive: storage feature writes bunny.json with deploy block', async () => {
    mockZoneListing();
    const cb = spies();
    const result = await runInit(
      {
        apiKey: 'k',
        features: ['storage'],
        publicDir: 'dist',
        storageZone: 'my-app',
        storagePassword: 'pw',
        purge: 'all',
      },
      cb,
      { interactive: false, cwd: scratch },
    );
    expect(cb.multiselect).not.toHaveBeenCalled();
    expect(cb.ask).not.toHaveBeenCalled();
    expect(result.alreadyInitialized).toBe(false);
    expect(result.features).toEqual(['storage']);
    expect(result.storedScopes).toContain('account');
    expect(result.storedScopes).toContain('storage:my-app');
    const written = JSON.parse(await readFile(join(scratch, 'bunny.json'), 'utf8'));
    expect(written.deploy.publicDir).toBe('dist');
    expect(written.deploy.storageZone).toBe('my-app');
  });

  it('non-interactive: requires storage-zone when storage feature selected', async () => {
    mockZoneListing();
    const cb = spies();
    await expect(
      runInit({ apiKey: 'k', features: ['storage'] }, cb, { interactive: false, cwd: scratch }),
    ).rejects.toThrowError(/storage-zone required/);
  });

  it('non-interactive: dns-only feature writes bunny.json without deploy block', async () => {
    mockZoneListing();
    const cb = spies();
    const result = await runInit(
      { apiKey: 'k', features: ['dns'] },
      cb,
      { interactive: false, cwd: scratch },
    );
    expect(result.features).toEqual(['dns']);
    const written = JSON.parse(await readFile(join(scratch, 'bunny.json'), 'utf8'));
    expect(written.deploy).toBeUndefined();
  });

  it('non-interactive: refuses to overwrite without --force', async () => {
    await writeFile(join(scratch, 'bunny.json'), '{}');
    const cb = spies();
    const result = await runInit(
      { apiKey: 'k', features: ['storage'], storageZone: 'my-app', storagePassword: 'pw' },
      cb,
      { interactive: false, cwd: scratch },
    );
    expect(result.alreadyInitialized).toBe(true);
  });

  it('non-interactive: --force overwrites existing bunny.json', async () => {
    await writeFile(join(scratch, 'bunny.json'), '{"old":true}');
    mockZoneListing();
    const cb = spies();
    const result = await runInit(
      { apiKey: 'k', features: ['storage'], storageZone: 'my-app', storagePassword: 'pw' },
      cb,
      { interactive: false, cwd: scratch, force: true },
    );
    expect(result.alreadyInitialized).toBe(false);
    const written = JSON.parse(await readFile(join(scratch, 'bunny.json'), 'utf8'));
    expect(written.deploy.storageZone).toBe('my-app');
  });

  it('skips auth step when account key already in env', async () => {
    process.env[ENV_KEY] = 'env-key';
    mockZoneListing();
    const cb = spies();
    const result = await runInit(
      { features: ['storage'], storageZone: 'my-app', storagePassword: 'pw' },
      cb,
      { interactive: false, cwd: scratch },
    );
    expect(result.storedScopes).not.toContain('account');
    expect(result.storedScopes).toContain('storage:my-app');
  });

  it('throws when no account key in non-interactive mode and none in env', async () => {
    const cb = spies();
    await expect(
      runInit({ features: ['storage'], storageZone: 'my-app' }, cb, { interactive: false, cwd: scratch }),
    ).rejects.toThrowError(/Bunny API key required/);
  });

  it('updates .gitignore when present (and not yet listing state file)', async () => {
    await writeFile(join(scratch, '.gitignore'), 'node_modules\n');
    mockZoneListing();
    const cb = spies();
    const result = await runInit(
      { apiKey: 'k', features: ['storage'], storageZone: 'my-app', storagePassword: 'pw' },
      cb,
      { interactive: false, cwd: scratch },
    );
    expect(result.gitignoreUpdated).toBe(true);
    const gi = await readFile(join(scratch, '.gitignore'), 'utf8');
    expect(gi).toContain('.bunny-state.json');
  });

  it('interactive: feature multi-select drives the flow', async () => {
    mockZoneListing();

    // Sequenced answers per call site.
    const askAnswers = ['', 'pw']; // publicDir (empty=default), then password
    const pickAnswers = ['my-app', '', 'all']; // storageZone, no pullZone, purge=all
    let askIdx = 0;
    let pickIdx = 0;

    const ask = vi.fn(async (_q: { name: string; message: string; mode: 'plain' | 'mask' }) => {
      return askAnswers[askIdx++] ?? '';
    });
    const pick = vi.fn(async (_q: { name: string; message: string; choices: Array<{ value: string; label: string }> }) => {
      return pickAnswers[pickIdx++] ?? '';
    });
    const multiselect = vi.fn(async () => ['storage'] as Array<'storage' | 'dns' | 'stream' | 'containers' | 'scripting'>);
    const confirm = vi.fn(async () => false);

    const wasTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    await mkdir(join(scratch, 'dist'), { recursive: true });

    try {
      const result = await runInit(
        { apiKey: 'k' },
        { ask, pick, multiselect, confirm },
        { interactive: true, cwd: scratch },
      );
      expect(multiselect).toHaveBeenCalledOnce();
      expect(result.features).toEqual(['storage']);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: wasTTY, configurable: true });
    }
  });
});
