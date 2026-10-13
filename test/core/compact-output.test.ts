import { describe, expect, it } from 'vitest';
import { compactDnsRecord, summarizeDnsZone } from '../../src/core/dns.js';
import { compactPullZone } from '../../src/core/zones.js';

describe('compact agent-facing shapes', () => {
  it('summarizes a DNS zone to id, domain and record count', () => {
    expect(
      summarizeDnsZone({ Id: 5, Domain: 'example.com', Records: [{ Id: 1, Type: 0, Name: '', Value: '1.2.3.4' }] }),
    ).toEqual({ Id: 5, Domain: 'example.com', records: 1 });
  });

  it('compacts a DNS record with a type name and only meaningful fields', () => {
    const raw = {
      Id: 9,
      Type: 7,
      Name: '',
      Value: 'my-site',
      Ttl: 300,
      Priority: 0,
      Weight: 0,
      Port: 0,
      LinkName: '42',
      Accelerated: false,
      AcceleratedPullZoneId: 0,
      IPGeoLocationInfo: { Country: 'SG' },
    } as unknown as Parameters<typeof compactDnsRecord>[0];
    expect(compactDnsRecord(raw)).toEqual({ Id: 9, type: 'PULLZONE', name: '@', value: 'my-site', ttl: 300, linkName: '42' });
  });

  it('compacts a pull zone to identity, origin and hostname SSL state', () => {
    const raw = {
      Id: 3,
      Name: 'my-site',
      OriginUrl: 'https://origin.example.com',
      Enabled: true,
      Hostnames: [
        { Value: 'my-site.b-cdn.net', HasCertificate: true, ForceSSL: false },
        { Value: 'example.com', HasCertificate: true, ForceSSL: true },
      ],
      CacheControlMaxAgeOverride: 0,
    } as unknown as Parameters<typeof compactPullZone>[0];
    expect(compactPullZone(raw)).toEqual({
      Id: 3,
      Name: 'my-site',
      OriginUrl: 'https://origin.example.com',
      Enabled: true,
      hostnames: [
        { host: 'my-site.b-cdn.net', ssl: true, forceSsl: false },
        { host: 'example.com', ssl: true, forceSsl: true },
      ],
    });
  });
});

describe('pull zone secret stripping', () => {
  it('removes the token-auth key and S3 signing credentials', async () => {
    const { toPublicPullZone } = await import('../../src/core/zones.js');
    const raw = {
      Id: 1,
      Name: 'pz',
      OriginUrl: null,
      Enabled: true,
      Hostnames: [],
      ZoneSecurityKey: 'secret-token-key',
      AWSSigningKey: 'aws-key',
      AWSSigningSecret: 'aws-secret',
      AWSSigningRegionName: 'us-east-1',
    } as unknown as Parameters<typeof toPublicPullZone>[0];
    const pub = toPublicPullZone(raw) as unknown as Record<string, unknown>;
    expect(pub).not.toHaveProperty('ZoneSecurityKey');
    expect(pub).not.toHaveProperty('AWSSigningKey');
    expect(pub).not.toHaveProperty('AWSSigningSecret');
    expect(pub['AWSSigningRegionName']).toBe('us-east-1');
    expect(pub['Name']).toBe('pz');
  });
});
