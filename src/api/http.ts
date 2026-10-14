import { request } from 'undici';
import type { Dispatcher } from 'undici';
import { logger } from '../util/logger.js';
import { AuthError, BunnyApiError, RejectedCredentialError, parseBunnyErrorBody } from './errors.js';

// Auth scope names used by the credentials resolver. Each call site declares
// which credential it needs; the http layer asks the resolver to provide it.
export type AuthScope =
  | { kind: 'account' }
  | { kind: 'storage'; zone: string }
  | { kind: 'stream'; libraryId: string }
  | { kind: 'database'; name: string };

export type CredentialResolver = (scope: AuthScope) => Promise<string>;

// What to do when Bunny rejects the credential for a scope.
function rejectedHint(scope: AuthScope): string {
  switch (scope.kind) {
    case 'account':
      return 'The API key is wrong or was revoked. Run `bunny configure` to store a new one (dash.bunny.net → Account Settings → API).';
    case 'storage':
      return `The password used for storage zone "${scope.zone}" was rejected. If BUNNY_STORAGE_PASSWORD_* or a stored zone password is set, it may be stale; remove it to use the one fetched with your API key.`;
    case 'stream':
      return `The API key used for Stream library ${scope.libraryId} was rejected. If BUNNY_STREAM_KEY_* or a stored library key is set, it may be stale; remove it to use the one fetched with your API key.`;
    case 'database':
      return `The access key for database "${scope.name}" was rejected.`;
  }
}

export type CallOptions = {
  base: string;
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined>;
  // For JSON: pass a plain object. For binary uploads: pass a Buffer.
  body?: unknown;
  scope: AuthScope;
  contentType?: string;
  retry?: { max?: number; baseMs?: number };
  signal?: AbortSignal;
  // For binary GETs (storage downloads).
  binary?: boolean;
};

export type HttpClientDeps = {
  resolveCredential: CredentialResolver;
  // Hookable for tests; defaults to undici.request.
  fetcher?: typeof request;
  // Hookable for tests; defaults to setTimeout.
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_RETRY = { max: 5, baseMs: 500 } as const;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function jitter(ms: number): number {
  // ±25% jitter to avoid thundering herd.
  const delta = ms * 0.25;
  return Math.round(ms + (Math.random() * 2 - 1) * delta);
}

function backoffMs(attempt: number, base: number): number {
  return Math.min(jitter(base * 2 ** attempt), 30_000);
}

function buildUrl(base: string, path: string, query?: CallOptions['query']): string {
  const url = new URL(path, base);
  if (query) {
    for (const [key, val] of Object.entries(query)) {
      if (val === undefined) continue;
      url.searchParams.set(key, String(val));
    }
  }
  return url.toString();
}

export function createHttpClient(deps: HttpClientDeps) {
  const fetcher = deps.fetcher ?? request;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  async function callBunny<T>(opts: CallOptions): Promise<T> {
    const accessKey = await deps.resolveCredential(opts.scope);
    if (!accessKey) {
      throw new AuthError(`No credential available for scope ${JSON.stringify(opts.scope)}`);
    }

    const max = opts.retry?.max ?? DEFAULT_RETRY.max;
    const base = opts.retry?.baseMs ?? DEFAULT_RETRY.baseMs;
    const url = buildUrl(opts.base, opts.path, opts.query);
    const method = opts.method ?? 'GET';

    let lastErr: unknown;
    for (let attempt = 0; attempt <= max; attempt++) {
      try {
        const headers: Record<string, string> = {
          AccessKey: accessKey,
          Accept: 'application/json',
        };

        let bodyToSend: Dispatcher.RequestOptions['body'];
        if (opts.body === undefined || opts.body === null) {
          bodyToSend = undefined;
        } else if (Buffer.isBuffer(opts.body) || opts.body instanceof Uint8Array) {
          bodyToSend = opts.body as Buffer;
          if (opts.contentType) headers['Content-Type'] = opts.contentType;
        } else {
          bodyToSend = JSON.stringify(opts.body);
          headers['Content-Type'] = opts.contentType ?? 'application/json';
        }

        const res = await fetcher(url, {
          method,
          headers,
          body: bodyToSend,
          signal: opts.signal,
        });

        const status = res.statusCode;
        if (status === 401 || status === 403) {
          // Drain body to free socket; throw without retry.
          await res.body.text().catch(() => '');
          throw new RejectedCredentialError(
            `Bunny rejected credentials (HTTP ${status}) for ${method} ${opts.path}. ${rejectedHint(opts.scope)}`,
          );
        }

        if (status >= 200 && status < 300) {
          if (status === 204 || method === 'DELETE') {
            await res.body.text().catch(() => '');
            return undefined as unknown as T;
          }
          if (opts.binary) {
            const buf = Buffer.from(await res.body.arrayBuffer());
            return buf as unknown as T;
          }
          const text = await res.body.text();
          if (text.length === 0) return undefined as unknown as T;
          return JSON.parse(text) as T;
        }

        const text = await res.body.text();

        if (RETRYABLE_STATUS.has(status) && attempt < max) {
          const retryAfter = res.headers['retry-after'];
          const delay = retryAfterMs(retryAfter) ?? backoffMs(attempt, base);
          logger.debug(`HTTP ${status} on ${method} ${opts.path}; retry in ${delay}ms (attempt ${attempt + 1}/${max})`);
          await sleep(delay);
          continue;
        }

        throw parseBunnyErrorBody(status, text);
      } catch (err) {
        lastErr = err;
        if (err instanceof AuthError || err instanceof BunnyApiError) throw err;
        if (attempt >= max) break;
        const delay = backoffMs(attempt, base);
        logger.debug(`Network error on ${method} ${opts.path}: ${(err as Error).message}; retry in ${delay}ms`);
        await sleep(delay);
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error(`Unknown error calling ${method} ${opts.path}`);
  }

  return { callBunny };
}

function retryAfterMs(header: string | string[] | undefined): number | null {
  if (!header) return null;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds)) return seconds * 1000;
  // HTTP-date format - ignore for simplicity; backoff falls through.
  return null;
}
