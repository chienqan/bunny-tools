import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pickByName, resolveDnsZoneId, resolvePullZoneId } from '../../src/core/resolve.js';
import { getMockAgent } from '../setup.js';

describe('pickByName', () => {
  const items = [{ n: 'Alpha' }, { n: 'beta' }];

  it('matches case-insensitively', () => {
    expect(pickByName(items, 'ALPHA', (i) => i.n, 'Thing', 'bunny thing list')).toEqual({ n: 'Alpha' });
  });

  it('lists what exists when nothing matches', () => {
    expect(() => pickByName(items, 'gamma', (i) => i.n, 'Thing', 'bunny thing list')).toThrowError(
      /Thing "gamma" not found\. Available: Alpha, beta\. See `bunny thing list`/,
    );
  });
});

describe('name → id resolvers', () => {
  let prevKey: string | undefined;

  beforeEach(() => {
    prevKey = process.env['BUNNY_API_KEY'];
    process.env['BUNNY_API_KEY'] = 'account-key';
  });

  afterEach(() => {
    if (prevKey === undefined) delete process.env['BUNNY_API_KEY'];
    else process.env['BUNNY_API_KEY'] = prevKey;
  });

  it('numeric refs pass through without a request', async () => {
    // No interceptors registered: any HTTP call would throw.
    expect(await resolvePullZoneId('123')).toBe(123);
    expect(await resolveDnsZoneId(456)).toBe(456);
  });

  it('pull zone by name', async () => {
    getMockAgent()
      .get('https://api.bunny.net')
      .intercept({ path: /\/pullzone.*/, method: 'GET' })
      .reply(200, { Items: [{ Id: 9, Name: 'my-site', OriginUrl: null, Enabled: true, Hostnames: [] }], HasMoreItems: false });
    expect(await resolvePullZoneId('my-site')).toBe(9);
  });

  it('DNS zone by domain, ignoring a trailing dot', async () => {
    getMockAgent()
      .get('https://api.bunny.net')
      .intercept({ path: /\/dnszone.*/, method: 'GET' })
      .reply(200, { Items: [{ Id: 5, Domain: 'example.com' }], HasMoreItems: false });
    expect(await resolveDnsZoneId('Example.com.')).toBe(5);
  });
});
