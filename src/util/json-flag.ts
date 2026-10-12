// Parse a JSON-valued CLI flag (`--body`, `--rule`) with an error that names the flag.

import { ValidationError } from '../api/errors.js';

export function parseJsonFlag<T = Record<string, unknown>>(raw: string | undefined, flag: string): T {
  if (!raw) throw new ValidationError(`--${flag} '<json>' is required.`);
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new ValidationError(`Invalid --${flag} JSON: ${(err as Error).message}`);
  }
}
