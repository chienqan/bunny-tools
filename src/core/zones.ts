// core/zones - typed wrappers for storage-zone + pull-zone CRUD.
// Edge rules live inside pull-zone responses; mutate via list+update flow.

import { createAccountClient } from '../api/account.js';
import type { PullZone } from '../api/account.js';
import { toPublicZone } from './storage-ops.js';
import type { PublicStorageZone } from './storage-ops.js';
import { resolveCredential } from '../config/credential-resolver.js';

function client() {
  return createAccountClient({ resolveCredential: (s) => resolveCredential(s) });
}

// Storage zones --------------------------------------------------------------
// Results go through toPublicZone so zone passwords never reach stdout or MCP.

export async function listStorageZones(): Promise<PublicStorageZone[]> {
  return (await client().listStorageZones()).map(toPublicZone);
}

export async function getStorageZone(idOrName: string | number): Promise<PublicStorageZone> {
  if (typeof idOrName === 'number') return toPublicZone(await client().getStorageZone(idOrName));
  const found = await client().getStorageZoneByName(idOrName);
  if (!found) throw new Error(`Storage zone "${idOrName}" not found. Run \`bunny storage ls\` to see zones.`);
  return toPublicZone(found);
}

export type StorageZoneCreateInput = {
  name: string;
  region?: string;
  replicationRegions?: string[];
  zoneTier?: number;
};

export async function createStorageZone(input: StorageZoneCreateInput): Promise<PublicStorageZone> {
  const created = await client().createStorageZone({
    Name: input.name,
    ...(input.region ? { Region: input.region } : {}),
    ...(input.replicationRegions ? { ReplicationRegions: input.replicationRegions } : {}),
    ...(input.zoneTier !== undefined ? { ZoneTier: input.zoneTier } : {}),
  });
  return toPublicZone(created);
}

// Bunny answers `POST /storagezone/{id}` with 204 No Content, so re-fetch to
// return the updated zone.
export async function updateStorageZone(id: number, body: Record<string, unknown>): Promise<PublicStorageZone> {
  const c = client();
  await c.updateStorageZone(id, body);
  return toPublicZone(await c.getStorageZone(id));
}

export async function deleteStorageZone(id: number): Promise<void> {
  await client().deleteStorageZone(id);
}

// Pull zones -----------------------------------------------------------------

export async function listPullZones(): Promise<PullZone[]> {
  return client().listPullZones();
}

export async function getPullZone(id: number): Promise<PullZone> {
  return client().getPullZone(id);
}

export async function createPullZone(name: string, originUrl: string): Promise<PullZone> {
  return client().createPullZone({ Name: name, OriginUrl: originUrl });
}

export async function updatePullZone(id: number, body: Record<string, unknown>): Promise<PullZone> {
  return client().updatePullZone(id, body);
}

export async function deletePullZone(id: number): Promise<void> {
  await client().deletePullZone(id);
}

// Edge rules - listed via the parent pull zone object, but mutated through
// dedicated subresource endpoints. Bunny's `POST /pullzone/{id}` silently
// drops EdgeRules in the body, so list-then-update with the rules array
// looks successful but never persists - we must hit /edgerules/addOrUpdate.

// Bunny edge-rule trigger entry. Multiple triggers per rule are AND'd by
// default (matching TriggerMatchingType). Each trigger has its own pattern
// list and matching mode.
export type EdgeRuleTrigger = {
  Type: number;
  PatternMatches: string[];
  PatternMatchingType?: number;
  // Bunny also accepts these per-trigger fields for response-header /
  // request-header matching; we don't generate them today but pass-through
  // when the user supplies a raw rule.
  Parameter1?: string;
};

export type EdgeRule = {
  Guid?: string;
  ActionType: number;
  TriggerMatchingType?: number;
  Triggers?: EdgeRuleTrigger[];
  ActionParameter1?: string;
  ActionParameter2?: string;
  Description?: string;
  Enabled?: boolean;
};

type PullZoneWithRules = PullZone & { EdgeRules?: EdgeRule[] };

export async function listEdgeRules(pullZoneId: number): Promise<EdgeRule[]> {
  const pz = (await client().getPullZone(pullZoneId)) as PullZoneWithRules;
  return pz.EdgeRules ?? [];
}

export async function addEdgeRule(pullZoneId: number, rule: EdgeRule): Promise<EdgeRule[]> {
  await client().addOrUpdateEdgeRule(pullZoneId, rule as unknown as Record<string, unknown>);
  return listEdgeRules(pullZoneId);
}

export async function deleteEdgeRule(pullZoneId: number, ruleGuid: string): Promise<EdgeRule[]> {
  await client().deleteEdgeRule(pullZoneId, ruleGuid);
  return listEdgeRules(pullZoneId);
}

// Hostnames - same dedicated-subresource pattern as edge rules. Returns the
// updated hostname list after each mutation so callers can confirm state.

export async function listPullZoneHostnames(pullZoneId: number): Promise<string[]> {
  const pz = await client().getPullZone(pullZoneId);
  return (pz.Hostnames ?? []).map((h) => h.Value);
}

export async function addPullZoneHostname(pullZoneId: number, hostname: string): Promise<string[]> {
  await client().addPullZoneHostname(pullZoneId, hostname);
  return listPullZoneHostnames(pullZoneId);
}

export async function removePullZoneHostname(pullZoneId: number, hostname: string): Promise<string[]> {
  await client().removePullZoneHostname(pullZoneId, hostname);
  return listPullZoneHostnames(pullZoneId);
}

// Request a Let's Encrypt cert for a hostname on a pull zone, then poll the
// PZ until that hostname's HasCertificate flips true (or timeout). Validates
// the hostname is on the PZ before firing - Bunny's loadFreeCertificate
// endpoint accepts any hostname and resolves PZ from it, but failing fast
// produces a better error than waiting for the cert that will never arrive.

export type EnableSslResult = {
  hasCertificate: boolean;
  waitedMs: number;
  forceSslSet?: boolean;
};

// Direct ForceSSL toggle without provisioning a cert. Bunny rejects this
// when HasCertificate=false (would cause infinite redirect to broken HTTPS),
// so callers must verify cert state first when toggling on. Toggling off
// is always safe.
export async function setHostnameForceSSL(
  pullZoneId: number,
  hostname: string,
  force: boolean,
): Promise<void> {
  await client().setPullZoneForceSSL(pullZoneId, hostname, force);
}

const DEFAULT_SSL_TIMEOUT_MS = 90_000;
const DEFAULT_SSL_POLL_INTERVAL_MS = 5_000;

export async function enablePullZoneSSL(
  pullZoneId: number,
  hostname: string,
  opts: {
    timeoutMs?: number;
    pollIntervalMs?: number;
    /** When true, skips the auto-flip of ForceSSL after cert provisions. */
    noForceSSL?: boolean;
  } = {},
): Promise<EnableSslResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_SSL_TIMEOUT_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_SSL_POLL_INTERVAL_MS;

  const c = client();

  // Pre-flight: verify hostname is on the PZ. Saves a 90s wait when the
  // user forgot to run `pullzone hostname add` first.
  const pzBefore = await c.getPullZone(pullZoneId);
  const matchedBefore = (pzBefore.Hostnames ?? []).find((h) => h.Value === hostname);
  if (!matchedBefore) {
    throw new Error(
      `${hostname} is not linked to pull zone "${pzBefore.Name}" (#${pzBefore.Id}). ` +
        `Run: bunny cdn hostname add ${pzBefore.Id} ${hostname}`,
    );
  }
  if (matchedBefore.HasCertificate === true) {
    // Cert already there - apply ForceSSL anyway so re-running on an existing
    // hostname brings it up to default-secure state. Idempotent on the API.
    let forceSslSet: boolean | undefined;
    if (!opts.noForceSSL && matchedBefore.ForceSSL !== true) {
      await c.setPullZoneForceSSL(pullZoneId, hostname, true);
      forceSslSet = true;
    }
    return { hasCertificate: true, waitedMs: 0, ...(forceSslSet ? { forceSslSet } : {}) };
  }

  await c.loadFreeCertificate(hostname);

  const startedAt = Date.now();
  for (;;) {
    const elapsed = Date.now() - startedAt;
    if (elapsed >= timeoutMs) {
      throw new Error(
        `Timed out after ${Math.round(elapsed / 1000)}s waiting for SSL certificate on ${hostname}. ` +
          `Cert provisioning may still complete in the background; re-run this command or inspect with ` +
          `\`bunny cdn hostname list ${pullZoneId}\`.`,
      );
    }
    await sleep(pollIntervalMs);
    const pz = await c.getPullZone(pullZoneId);
    const matched = (pz.Hostnames ?? []).find((h) => h.Value === hostname);
    if (matched?.HasCertificate === true) {
      const waitedMs = Date.now() - startedAt;
      // Auto-flip ForceSSL=true now that a valid cert exists. Default-on
      // matches 2026 best practice (HTTPS-only); --no-force-ssl on the
      // CLI / `noForceSSL: true` here opts out for HTTP+HTTPS coexistence.
      let forceSslSet: boolean | undefined;
      if (!opts.noForceSSL && matched.ForceSSL !== true) {
        await c.setPullZoneForceSSL(pullZoneId, hostname, true);
        forceSslSet = true;
      }
      return {
        hasCertificate: true,
        waitedMs,
        ...(forceSslSet ? { forceSslSet } : {}),
      };
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Compact pull zone for agent-facing output (MCP): identity, origin and
// hostnames, without the ~100 raw configuration fields Bunny returns.
export type CompactPullZone = {
  Id: number;
  Name: string;
  OriginUrl: string | null;
  Enabled: boolean;
  hostnames: Array<{ host: string; ssl: boolean; forceSsl: boolean }>;
};

export function compactPullZone(z: PullZone): CompactPullZone {
  return {
    Id: z.Id,
    Name: z.Name,
    OriginUrl: z.OriginUrl,
    Enabled: z.Enabled,
    hostnames: (z.Hostnames ?? []).map((h) => ({
      host: h.Value,
      ssl: h.HasCertificate === true,
      forceSsl: h.ForceSSL === true,
    })),
  };
}
