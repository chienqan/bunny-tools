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

  it('JS numbers are ids and need no request', async () => {
    // No interceptors registered: any HTTP call would throw.
    expect(await resolvePullZoneId(123)).toBe(123);
    expect(await resolveDnsZoneId(456)).toBe(456);
  });

  it('an all-digit string matching an id resolves to that id', async () => {
    getMockAgent()
      .get('https://api.bunny.net')
      .intercept({ path: /\/pullzone.*/, method: 'GET' })
      .reply(200, { Items: [{ Id: 123, Name: 'site', OriginUrl: null, Enabled: true, Hostnames: [] }], HasMoreItems: false });
    expect(await resolvePullZoneId('123')).toBe(123);
  });

  it('an all-digit name is found by name, not misread as an id', async () => {
    getMockAgent()
      .get('https://api.bunny.net')
      .intercept({ path: /\/pullzone.*/, method: 'GET' })
      .reply(200, { Items: [{ Id: 5789465, Name: '2024', OriginUrl: null, Enabled: true, Hostnames: [] }], HasMoreItems: false });
    expect(await resolvePullZoneId('2024')).toBe(5789465);
  });

  it('an all-digit string matching nothing lists what exists', async () => {
    getMockAgent()
      .get('https://api.bunny.net')
      .intercept({ path: /\/pullzone.*/, method: 'GET' })
      .reply(200, { Items: [{ Id: 1, Name: 'site', OriginUrl: null, Enabled: true, Hostnames: [] }], HasMoreItems: false });
    await expect(resolvePullZoneId('999')).rejects.toThrowError(/Pull zone "999" not found\. Available: site/);
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
