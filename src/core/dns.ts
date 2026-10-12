// core/dns - typed wrappers + record-type validation. UI-free.

import { z } from 'zod';
import { createAccountClient } from '../api/account.js';
import type { DnsRecord, DnsZone } from '../api/account.js';
import { resolveCredential } from '../config/credential-resolver.js';
import { ValidationError } from '../api/errors.js';

// Compute the FQDN that Bunny would assign to a record. Apex (`@` or empty)
// resolves to the bare zone domain; trailing-dot inputs are treated as
// already-qualified; everything else is `<name>.<domain>`.
export function computeFqdn(name: string, domain: string): string {
  if (name === '' || name === '@') return domain;
  if (name.endsWith('.')) return name.slice(0, -1);
  return `${name}.${domain}`;
}

// Bunny DNS record type → numeric code (per Bunny API spec, verified live).
// REDIRECT/PULLZONE/PTR/SCRIPT are Bunny-specific routing types not present
// in standard DNS. Numeric codes are Bunny-internal - they don't match
// RFC 1035 numbering.
//
// FLATTEN (code 6) is documented in Bunny's OpenAPI spec but the live API
// rejects it with `validation_error: Unknown record type` (verified rc.40
// against api.bunny.net). Dropped from supported types until Bunny enables
// it server-side; users hit the wall faster with a clear "unsupported"
// message than via a confusing API rejection.
export const RECORD_TYPE_CODES: Record<string, number> = {
  A: 0,
  AAAA: 1,
  CNAME: 2,
  TXT: 3,
  MX: 4,
  REDIRECT: 5,
  PULLZONE: 7,
  SRV: 8,
  CAA: 9,
  PTR: 10,
  SCRIPT: 11,
  NS: 12,
};

export const SUPPORTED_TYPES = Object.keys(RECORD_TYPE_CODES);

export type SupportedType = keyof typeof RECORD_TYPE_CODES;

// zod discriminated union - required fields per type. Validates BEFORE we hit the API.
const baseFields = z.object({
  name: z.string(),
  value: z.string().min(1),
  ttl: z.number().int().positive().optional(),
});
const ARecord = baseFields.extend({ type: z.literal('A') });
const AAAARecord = baseFields.extend({ type: z.literal('AAAA') });
const CNAMERecord = baseFields.extend({ type: z.literal('CNAME') });
const TXTRecord = baseFields.extend({ type: z.literal('TXT') });
const MXRecord = baseFields.extend({
  type: z.literal('MX'),
  priority: z.number().int().nonnegative(),
});
const SRVRecord = baseFields.extend({
  type: z.literal('SRV'),
  priority: z.number().int().nonnegative(),
  weight: z.number().int().nonnegative(),
  port: z.number().int().positive(),
});
const CAARecord = baseFields.extend({
  type: z.literal('CAA'),
  flags: z.number().int().nonnegative(),
  tag: z.string().min(1),
});
const NSRecord = baseFields.extend({ type: z.literal('NS') });
// Bunny-specific routing types. REDIRECT/PTR carry only a Value
// (URL/hostname/target). PULLZONE/SCRIPT need a `linkName` carrying the
// linked resource id (pull zone id or script id), which Bunny stores on
// the record so the dashboard can backfill the live state.
const RedirectRecord = baseFields.extend({ type: z.literal('REDIRECT') });
const PullzoneRecord = baseFields.extend({
  type: z.literal('PULLZONE'),
  linkName: z.string().min(1),
});
const PtrRecord = baseFields.extend({ type: z.literal('PTR') });
const ScriptRecord = baseFields.extend({
  type: z.literal('SCRIPT'),
  linkName: z.string().min(1),
});

export const RecordInputSchema = z.discriminatedUnion('type', [
  ARecord,
  AAAARecord,
  CNAMERecord,
  TXTRecord,
  MXRecord,
  SRVRecord,
  CAARecord,
  NSRecord,
  RedirectRecord,
  PullzoneRecord,
  PtrRecord,
  ScriptRecord,
]);

export type RecordInput = z.infer<typeof RecordInputSchema>;

export function parseRecordInput(raw: unknown): RecordInput {
  const result = RecordInputSchema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(
      `Invalid DNS record input: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }
  return result.data;
}

function toApiBody(rec: RecordInput): Record<string, unknown> {
  const code = RECORD_TYPE_CODES[rec.type];
  if (code === undefined) throw new ValidationError(`Unsupported DNS type: ${rec.type}`);
  const body: Record<string, unknown> = {
    Type: code,
    Name: rec.name,
    Value: rec.value,
  };
  if (rec.ttl !== undefined) body['Ttl'] = rec.ttl;
  if ('priority' in rec) body['Priority'] = rec.priority;
  if ('weight' in rec) body['Weight'] = rec.weight;
  if ('port' in rec) body['Port'] = rec.port;
  if ('flags' in rec) body['Flags'] = rec.flags;
  if ('tag' in rec) body['Tag'] = rec.tag;
  // PULLZONE (Type 7): Bunny's PUT /dnszone/{id}/records expects the numeric
  // pull zone id in `PullZoneId`, NOT the string `LinkName`. Sending LinkName
  // alone fails with "The pull zone ID is not valid" (Field: Value). The
  // dashboard sends PullZoneId; the response then derives Value and LinkName.
  // SCRIPT (Type 11) still uses LinkName (untested but no contradicting evidence).
  if (rec.type === 'PULLZONE') {
    body['PullZoneId'] = Number.parseInt(rec.linkName, 10);
  } else if ('linkName' in rec) {
    body['LinkName'] = rec.linkName;
  }
  return body;
}

function client() {
  return createAccountClient({ resolveCredential: (s) => resolveCredential(s) });
}

export async function listZones(): Promise<DnsZone[]> {
  return client().listDnsZones();
}

export async function getZone(id: number): Promise<DnsZone> {
  return client().getDnsZone(id);
}

export async function createZone(domain: string): Promise<DnsZone> {
  return client().createDnsZone(domain);
}

export async function deleteZone(id: number): Promise<void> {
  await client().deleteDnsZone(id);
}

export async function listRecords(zoneId: number): Promise<DnsRecord[]> {
  const zone = await client().getDnsZone(zoneId);
  return zone.Records ?? [];
}

export async function addRecord(zoneId: number, raw: unknown): Promise<DnsRecord> {
  const parsed = parseRecordInput(raw);
  // Centralized pre-flight for PULLZONE (Type-7). Bunny's API responds with
  // the misleading error "The pull zone ID is not valid" when the matched
  // hostname isn't linked to the pz, OR when it's linked but has no SSL
  // certificate. Catching this here covers the CLI command, MCP tool, and
  // any other caller that goes through addRecord.
  if (parsed.type === 'PULLZONE') {
    await preflightPullzoneRecord(zoneId, parsed.name, parsed.linkName);
  }
  return client().addDnsRecord(zoneId, toApiBody(parsed));
}

async function preflightPullzoneRecord(
  zoneId: number,
  name: string,
  linkName: string,
): Promise<void> {
  const pzId = Number.parseInt(linkName, 10);
  if (!Number.isFinite(pzId) || pzId <= 0) {
    throw new ValidationError(
      `linkName must be a numeric pull zone id, got "${linkName}"`,
    );
  }
  const c = client();
  const [pz, dnsZone] = await Promise.all([
    c.getPullZone(pzId),
    c.getDnsZone(zoneId),
  ]);
  const fqdn = computeFqdn(name, dnsZone.Domain);
  const matched = (pz.Hostnames ?? []).find((h) => h.Value === fqdn);
  if (!matched) {
    throw new ValidationError(
      `${fqdn} is not linked to pull zone "${pz.Name}" (#${pz.Id}). ` +
        `Run: bunny cdn hostname add ${pz.Name} ${fqdn}`,
    );
  }
  if (matched.HasCertificate !== true) {
    throw new ValidationError(
      `${fqdn} is linked to pull zone "${pz.Name}" (#${pz.Id}) but has no SSL certificate yet. ` +
        `Run: bunny cdn hostname add ${pz.Name} ${fqdn} (re-running provisions the cert).`,
    );
  }
  // No conflict-with-other-records check: Bunny accepts PULLZONE alongside
  // A/AAAA at the same Name (verified live in rc.30). CNAME may still be
  // exclusive per DNS RFC, but Bunny's gate isn't visible to us so we
  // don't pre-empt - let Bunny return its own error if any.
}

export async function updateRecord(zoneId: number, recordId: number, body: Record<string, unknown>): Promise<DnsRecord> {
  return client().updateDnsRecord(zoneId, recordId, body);
}

export async function deleteRecord(zoneId: number, recordId: number): Promise<void> {
  await client().deleteDnsRecord(zoneId, recordId);
}

export function recordTypeName(code: number): string {
  return Object.entries(RECORD_TYPE_CODES).find(([, v]) => v === code)?.[0] ?? `code:${code}`;
}

// Compact shapes for agent-facing output (MCP). Bunny returns ~25 fields per
// record (geo info, monitor state, numeric type codes); agents need the few
// that identify and describe a record.
export type DnsZoneSummary = { Id: number; Domain: string; records: number };
export type CompactDnsRecord = {
  Id: number;
  type: string;
  name: string;
  value: string;
  ttl?: number;
  priority?: number;
  weight?: number;
  port?: number;
  linkName?: string;
  disabled?: boolean;
};

export function summarizeDnsZone(z: DnsZone): DnsZoneSummary {
  return { Id: z.Id, Domain: z.Domain, records: z.Records?.length ?? 0 };
}

export function compactDnsRecord(r: DnsRecord): CompactDnsRecord {
  return {
    Id: r.Id,
    type: recordTypeName(r.Type),
    name: r.Name || '@',
    value: r.Value,
    ...(r.Ttl ? { ttl: r.Ttl } : {}),
    ...(r.Priority ? { priority: r.Priority } : {}),
    ...(r.Weight ? { weight: r.Weight } : {}),
    ...(r.Port ? { port: r.Port } : {}),
    ...(r.LinkName ? { linkName: r.LinkName } : {}),
    ...(r.Disabled ? { disabled: true } : {}),
  };
}
