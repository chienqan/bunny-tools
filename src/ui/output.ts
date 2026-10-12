// Shared command output contract:
//   - stdout carries the result only (table, or JSON with --json)
//   - stderr carries progress, confirmations, and human success lines
//   - destructive commands need --yes in non-interactive shells
// Keeping this in one place means every command behaves the same for agents.

import { confirm, isInteractive } from './prompt.js';
import type { ProgressReporter } from './progress.js';
import { renderTable } from './table.js';

export function printJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

// List output: JSON array with --json, aligned table otherwise.
export function printList<T>(
  items: T[],
  opts: { json?: boolean | undefined; empty: string; row: (item: T) => Record<string, string | number> },
): void {
  if (opts.json) return printJson(items);
  if (items.length === 0) {
    process.stdout.write(`${opts.empty}\n`);
    return;
  }
  process.stdout.write(renderTable(items.map(opts.row)) + '\n');
}

// Mutation output: JSON result on stdout with --json, else a success line on stderr.
export function reportDone(
  progress: ProgressReporter,
  json: boolean | undefined,
  data: unknown,
  human: string,
): void {
  if (json) printJson(data);
  else progress.succeed(human);
}

// Returns true when the destructive action may proceed.
export async function confirmDestructive(
  progress: ProgressReporter,
  yes: boolean | undefined,
  message: string,
): Promise<boolean> {
  if (yes) return true;
  if (!isInteractive()) {
    progress.fail('Pass --yes to confirm in non-interactive shells.');
    return false;
  }
  const ok = await confirm({ message, default: false });
  if (!ok) progress.info('Aborted.');
  return ok;
}
