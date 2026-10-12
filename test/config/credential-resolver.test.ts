import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  envVarSuffix,
  maskCredential,
  resolveCredential,
  scopeToAccount,
  scopeToEnvVars,
} from '../../src/config/credential-resolver.js';
import { AuthError } from '../../src/api/errors.js';
import type { AuthScope } from '../../src/api/http.js';

const ENV_KEYS = [
  'BUNNY_API_KEY',
  'BUNNY_STORAGE_PASSWORD',
  'BUNNY_STORAGE_PASSWORD_MY_APP',
  'BUNNY_STREAM_KEY',
  'BUNNY_STREAM_KEY_42',
];

describe('credential resolver', () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      originalEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      const v = originalEnv[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('scopeToAccount produces stable account names', () => {
    expect(scopeToAccount({ kind: 'account' })).toBe('account');
    expect(scopeToAccount({ kind: 'storage', zone: 'my-app' })).toBe('storage:my-app');
    expect(scopeToAccount({ kind: 'stream', libraryId: '42' })).toBe('stream:42');
    expect(scopeToAccount({ kind: 'database', name: 'main' })).toBe('database:main');
  });

  it('scopeToEnvVars emits expected names', () => {
    expect(scopeToEnvVars({ kind: 'storage', zone: 'my-app' })).toEqual([
      'BUNNY_STORAGE_PASSWORD_MY_APP',
      'BUNNY_STORAGE_PASSWORD',
    ]);
  });

  it('envVarSuffix avoids collisions between separator variants', () => {
    // `my-app` and `my_app` must produce different suffixes.
    expect(envVarSuffix('my-app')).not.toBe(envVarSuffix('my__app'));
    expect(envVarSuffix('my_app')).toBe('MY_APP');
    expect(envVarSuffix('my__app')).toBe('MY_X2APP');
    expect(envVarSuffix('my-app')).toBe('MY_APP');
  });

  it('envVarSuffix sanitizes special chars in stream + database scopes', () => {
    expect(scopeToEnvVars({ kind: 'stream', libraryId: 'lib.42' })).toEqual([
      'BUNNY_STREAM_KEY_LIB_42',
      'BUNNY_STREAM_KEY',
    ]);
    expect(scopeToEnvVars({ kind: 'database', name: 'main-db' })).toEqual([
      'BUNNY_DATABASE_KEY_MAIN_DB',
    ]);
  });

  it('flag override wins over everything', async () => {
    process.env['BUNNY_API_KEY'] = 'env-key';
    const v = await resolveCredential({ kind: 'account' }, { flag: 'flag-key', keychain: null });
    expect(v).toBe('flag-key');
  });

  it('scoped env beats generic env', async () => {
    process.env['BUNNY_STORAGE_PASSWORD_MY_APP'] = 'scoped';
    process.env['BUNNY_STORAGE_PASSWORD'] = 'generic';
    const v = await resolveCredential({ kind: 'storage', zone: 'my-app' }, { keychain: null });
    expect(v).toBe('scoped');
  });

  it('falls through to keychain (profile-prefixed in rc.9)', async () => {
    const fake = {
      getPassword: vi.fn(async () => 'kc-key'),
      setPassword: vi.fn(),
      deletePassword: vi.fn(),
      findCredentials: vi.fn(),
    };
    const v = await resolveCredential({ kind: 'account' } as AuthScope, { keychain: fake });
    expect(v).toBe('kc-key');
    // rc.9: keychain entries are <profile>:<scope>; default profile maps to "default:account".
    expect(fake.getPassword).toHaveBeenCalledWith('bunny-tools', 'default:account');
  });

  it('throws AuthError when nothing resolves and no TTY prompt', async () => {
    const fake = {
      getPassword: vi.fn(async () => null),
      setPassword: vi.fn(),
      deletePassword: vi.fn(),
      findCredentials: vi.fn(),
    };
    await expect(
      resolveCredential({ kind: 'account' } as AuthScope, { keychain: fake }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('maskCredential redacts long values', () => {
    expect(maskCredential('abcd1234efgh')).toBe('***efgh');
    expect(maskCredential('abc')).toBe('***');
  });
});
