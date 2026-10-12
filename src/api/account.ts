// Account API client (https://api.bunny.net). Account-scoped endpoints used
// by deploy + purge + zone CRUD. Always paginates page=1+, never page=0.

import type { CredentialResolver } from './http.js';
import { createHttpClient } from './http.js';

const BASE = 'https://api.bunny.net';

export type StorageZone = {
  Id: number;
  Name: string;
  Region: string;
  StorageUsed: number;
  FilesStored: number;
  ReplicationRegions: string[];
  PullZones: Array<{ Id: number; Name: string }>;
  // Zone-scoped secrets returned to account-key callers. Used to derive the
  // storage credential automatically; stripped before any user-facing output.
  Password?: string;
  ReadOnlyPassword?: string;
};

export type PullZoneHostname = {
  Id?: number;
  Value: string;
  // Bunny populates these after `loadFreeCertificate` finishes provisioning a
  // Let's Encrypt cert. PULLZONE-type DNS records are silently rejected when
  // the matched hostname has HasCertificate=false.
  HasCertificate?: boolean;
  ForceSSL?: boolean;
  IsSystemHostname?: boolean;
};

export type PullZone = {
  Id: number;
  Name: string;
  OriginUrl: string | null;
  Enabled: boolean;
  Hostnames: PullZoneHostname[];
};

export type AccountClientOptions = {
  resolveCredential: CredentialResolver;
  base?: string;
};

export function createAccountClient(opts: AccountClientOptions) {
  const { callBunny } = createHttpClient({ resolveCredential: opts.resolveCredential });
  const base = opts.base ?? BASE;

  // Generic paginator. Always uses page=1+ to avoid Bunny's `page=0` array footgun.
  async function listAll<T>(path: string, extraQuery: Record<string, string | number> = {}): Promise<T[]> {
    const out: T[] = [];
    let page = 1;
    for (;;) {
      const res = await callBunny<{ Items: T[]; HasMoreItems: boolean }>({
        base,
        path,
        scope: { kind: 'account' },
        query: { ...extraQuery, page, perPage: 1000 },
      });
      out.push(...(res.Items ?? []));
      if (!res.HasMoreItems) return out;
      page++;
      if (page > 100) throw new Error(`Pagination runaway on ${path}; aborted at page 100.`);
    }
  }

  return {
    listStorageZones: () => listAll<StorageZone>('/storagezone'),
    getStorageZoneByName: async (name: string): Promise<StorageZone | undefined> => {
      const zones = await listAll<StorageZone>('/storagezone', { search: name });
      return zones.find((z) => z.Name === name);
    },
    getStorageZone: (id: number) =>
      callBunny<StorageZone>({ base, path: `/storagezone/${id}`, scope: { kind: 'account' } }),
    createStorageZone: (body: { Name: string; Region?: string; ReplicationRegions?: string[]; ZoneTier?: number }) =>
      callBunny<StorageZone>({ base, path: '/storagezone', method: 'POST', scope: { kind: 'account' }, body }),
    deleteStorageZone: (id: number) =>
      callBunny<void>({ base, path: `/storagezone/${id}`, method: 'DELETE', scope: { kind: 'account' } }),
    updateStorageZone: (id: number, body: Record<string, unknown>) =>
      callBunny<StorageZone>({ base, path: `/storagezone/${id}`, method: 'POST', scope: { kind: 'account' }, body }),

    listPullZones: () => listAll<PullZone>('/pullzone'),
    getPullZone: (id: number) =>
      callBunny<PullZone>({ base, path: `/pullzone/${id}`, scope: { kind: 'account' } }),
    createPullZone: (body: { Name: string; OriginUrl: string }) =>
      callBunny<PullZone>({ base, path: '/pullzone', method: 'POST', scope: { kind: 'account' }, body }),
    updatePullZone: (id: number, body: Record<string, unknown>) =>
      callBunny<PullZone>({ base, path: `/pullzone/${id}`, method: 'POST', scope: { kind: 'account' }, body }),
    deletePullZone: (id: number) =>
      callBunny<void>({ base, path: `/pullzone/${id}`, method: 'DELETE', scope: { kind: 'account' } }),

    // Edge rules use dedicated subresource endpoints - Bunny's `POST /pullzone/{id}`
    // silently drops EdgeRules in the body, so we must hit /edgerules/addOrUpdate.
    addOrUpdateEdgeRule: (pullZoneId: number, rule: Record<string, unknown>) =>
      callBunny<void>({
        base,
        path: `/pullzone/${pullZoneId}/edgerules/addOrUpdate`,
        method: 'POST',
        scope: { kind: 'account' },
        body: rule,
      }),
    deleteEdgeRule: (pullZoneId: number, ruleGuid: string) =>
      callBunny<void>({
        base,
        path: `/pullzone/${pullZoneId}/edgerules/${ruleGuid}`,
        method: 'DELETE',
        scope: { kind: 'account' },
      }),

    // Hostnames are managed via dedicated subresource endpoints - Bunny's
    // `POST /pullzone/{id}` silently drops the Hostnames array (same gotcha
    // as edge rules). PULLZONE (Type-7) DNS records also fail silently
    // unless the FQDN is registered here first.
    addPullZoneHostname: (pullZoneId: number, hostname: string) =>
      callBunny<void>({
        base,
        path: `/pullzone/${pullZoneId}/addHostname`,
        method: 'POST',
        scope: { kind: 'account' },
        body: { Hostname: hostname },
      }),
    removePullZoneHostname: (pullZoneId: number, hostname: string) =>
      callBunny<void>({
        base,
        // Bunny rejects POST here with 405 - the correct verb is DELETE
        // (asymmetric to addHostname which uses POST). Body shape matches.
        path: `/pullzone/${pullZoneId}/removeHostname`,
        method: 'DELETE',
        scope: { kind: 'account' },
        body: { Hostname: hostname },
      }),

    // Toggle the HTTP→HTTPS auto-redirect on a custom hostname. Requires
    // a valid cert (HasCertificate=true) - flipping ForceSSL true on a
    // hostname without a cert produces an infinite-redirect loop, so the
    // CLI gates this behind `enable-ssl` having succeeded.
    setPullZoneForceSSL: (pullZoneId: number, hostname: string, force: boolean) =>
      callBunny<void>({
        base,
        path: `/pullzone/${pullZoneId}/setForceSSL`,
        method: 'POST',
        scope: { kind: 'account' },
        body: { Hostname: hostname, ForceSSL: force },
      }),

    // Request a Let's Encrypt certificate for a custom hostname. The endpoint
    // is account-scoped (Bunny resolves the PZ from hostname); response is
    // typically 200 immediately, but actual cert provisioning is async and
    // only flips Hostnames[].HasCertificate to true after Let's Encrypt
    // completes (usually 30-60s for DNS-01 when Bunny NS is authoritative).
    //
    // Bunny's API uses GET (not POST despite being a state-changing call), and
    // accepts useOnlyHttp01: when false and the hostname is on a Bunny DNS
    // zone, Bunny attempts DNS-01 validation first (works without any
    // pre-existing A/AAAA records). Default to false to make this work
    // out-of-the-box for users on Bunny DNS; HTTP-01 still falls through for
    // hostnames using external DNS.
    loadFreeCertificate: (hostname: string) =>
      callBunny<void>({
        base,
        path: '/pullzone/loadFreeCertificate',
        method: 'GET',
        scope: { kind: 'account' },
        query: { hostname, useOnlyHttp01: false },
      }),

    purgeByUrl: (url: string, async = false) =>
      callBunny<void>({
        base,
        path: '/purge',
        method: 'POST',
        scope: { kind: 'account' },
        query: { url, async },
      }),
    purgePullZoneByTag: (pullZoneId: number, cacheTag: string) =>
      callBunny<void>({
        base,
        path: `/pullzone/${pullZoneId}/purgeCache`,
        method: 'POST',
        scope: { kind: 'account' },
        body: { CacheTag: cacheTag },
      }),
    purgePullZone: (pullZoneId: number) =>
      callBunny<void>({
        base,
        path: `/pullzone/${pullZoneId}/purgeCache`,
        method: 'POST',
        scope: { kind: 'account' },
        body: {},
      }),

    // DNS
    listDnsZones: () => listAll<DnsZone>('/dnszone'),
    getDnsZone: (id: number) =>
      callBunny<DnsZone>({ base, path: `/dnszone/${id}`, scope: { kind: 'account' } }),
    createDnsZone: (domain: string) =>
      callBunny<DnsZone>({
        base,
        path: '/dnszone',
        method: 'POST',
        scope: { kind: 'account' },
        body: { Domain: domain },
      }),
    deleteDnsZone: (id: number) =>
      callBunny<void>({ base, path: `/dnszone/${id}`, method: 'DELETE', scope: { kind: 'account' } }),
    addDnsRecord: (zoneId: number, body: Record<string, unknown>) =>
      callBunny<DnsRecord>({
        base,
        path: `/dnszone/${zoneId}/records`,
        method: 'PUT',
        scope: { kind: 'account' },
        body,
      }),
    updateDnsRecord: (zoneId: number, recordId: number, body: Record<string, unknown>) =>
      callBunny<DnsRecord>({
        base,
        path: `/dnszone/${zoneId}/records/${recordId}`,
        method: 'POST',
        scope: { kind: 'account' },
        body,
      }),
    deleteDnsRecord: (zoneId: number, recordId: number) =>
      callBunny<void>({
        base,
        path: `/dnszone/${zoneId}/records/${recordId}`,
        method: 'DELETE',
        scope: { kind: 'account' },
      }),

    // Magic Containers
    listContainerApps: () => listAll<ContainerApp>('/mc/apps'),
    getContainerApp: (id: string) =>
      callBunny<ContainerApp>({ base, path: `/mc/apps/${id}`, scope: { kind: 'account' } }),
    createContainerApp: (body: Record<string, unknown>) =>
      callBunny<ContainerApp>({
        base,
        path: '/mc/apps',
        method: 'POST',
        scope: { kind: 'account' },
        body,
      }),
    deleteContainerApp: (id: string) =>
      callBunny<void>({ base, path: `/mc/apps/${id}`, method: 'DELETE', scope: { kind: 'account' } }),

    // Edge Scripting (Bunny Compute)
    listEdgeScripts: () => listAll<EdgeScript>('/compute/script'),
    getEdgeScript: (id: number) =>
      callBunny<EdgeScript>({ base, path: `/compute/script/${id}`, scope: { kind: 'account' } }),
    createEdgeScript: (body: Record<string, unknown>) =>
      callBunny<EdgeScript>({
        base,
        path: '/compute/script',
        method: 'POST',
        scope: { kind: 'account' },
        body,
      }),
    updateEdgeScriptCode: (id: number, body: Record<string, unknown>) =>
      callBunny<EdgeScript>({
        base,
        path: `/compute/script/${id}/code`,
        method: 'POST',
        scope: { kind: 'account' },
        body,
      }),
    deleteEdgeScript: (id: number) =>
      callBunny<void>({
        base,
        path: `/compute/script/${id}`,
        method: 'DELETE',
        scope: { kind: 'account' },
      }),
  };
}

export type AccountClient = ReturnType<typeof createAccountClient>;

export type ContainerApp = {
  Id: string;
  Name: string;
  Image?: string;
  Status?: string;
  Region?: string;
};

export type EdgeScript = {
  Id: number;
  Name: string;
  Code?: string;
  ScriptType?: number;
  Deployed?: boolean;
};

export type DnsZone = {
  Id: number;
  Domain: string;
  Records?: DnsRecord[];
};

export type DnsRecord = {
  Id: number;
  Type: number;
  Name: string;
  Value: string;
  Ttl?: number;
  Priority?: number;
  Weight?: number;
  Port?: number;
  Flags?: number;
  Tag?: string;
  Disabled?: boolean;
  // Bunny auto-spawns a hidden pull zone for some record types (REDIRECT
  // notably). Surfaced so the CLI can warn when it happens - the user's
  // account picks up an extra PZ they didn't ask for.
  AcceleratedPullZoneId?: number;
  Accelerated?: boolean;
  LinkName?: string;
};

// Map Bunny's region-code response field to the storage-endpoint subdomain.
// Bunny returns codes like "DE", "NY"; storage subdomains are lowercase.
// Storage regions: ny, la, sg, syd, uk, se, br, jh.
export function regionCodeToSubdomain(code: string): string {
  const lower = code.toLowerCase();
  // Some legacy zones return "DE" → use as the default `storage.bunnycdn.com` (no subdomain prefix).
  // For unknown codes, return as-is and let the user override via bunny.json.deploy.region.
  if (lower === 'de' || lower === 'falkenstein') return ''; // primary endpoint
  return lower;
}

export function storageBaseUrl(region: string): string {
  // The region becomes a hostname label; refuse anything that could change the host.
  if (region.length > 0 && !/^[a-z]{2,4}$/.test(region)) throw new Error(`Invalid storage region "${region}".`);
  const sub = region.length > 0 ? `${region}.` : '';
  return `https://${sub}storage.bunnycdn.com`;
}
