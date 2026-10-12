// Shared parsers for CLI output. Progress messages (`+ Created ... (id=NNN)`)
// land on stderr via ui/progress.ts; JSON / table output lands on stdout.
// Helpers that look up an id need to scan both.

import type { CliResult } from './bunny-cli.js';

function merged(r: CliResult): string {
  return `${r.stdout}\n${r.stderr}`;
}

export function extractIdNumeric(r: CliResult): number {
  const m = merged(r).match(/id=(\d+)/);
  if (!m?.[1]) throw new Error(`no numeric id in: ${merged(r)}`);
  return Number.parseInt(m[1], 10);
}

export function extractIdString(r: CliResult): string {
  // Stream video uploads return a guid-shaped id.
  const m = merged(r).match(/(?:guid|id)=([0-9a-f-]{8,})/i);
  if (!m?.[1]) throw new Error(`no string id in: ${merged(r)}`);
  return m[1];
}

export function extractGuid(text: string): string {
  const m = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (!m?.[0]) throw new Error(`no guid in: ${text}`);
  return m[0];
}

export function extractApiKey(jsonStdout: string): string {
  const m = jsonStdout.match(/"ApiKey":\s*"([^"]+)"/);
  if (!m?.[1]) throw new Error('no ApiKey field in JSON');
  return m[1];
}
