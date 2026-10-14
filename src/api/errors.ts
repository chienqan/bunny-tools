// Typed error hierarchy for bunny-tools.
//
// BunnyApiError wraps Bunny's `{ ErrorKey, Field, Message }` JSON envelope and
// also accepts plain-text bodies (some endpoints return that on 4xx).

export class BunnyError extends Error {
  override readonly name: string = 'BunnyError';
}

export class AuthError extends BunnyError {
  override readonly name = 'AuthError';
}

// No credential is stored for the scope (as opposed to Bunny rejecting one).
// Callers that can derive the credential another way catch this subclass only.
export class MissingCredentialError extends AuthError {}

// Bunny answered 401/403: a credential was sent but is wrong, revoked, or lacks access.
export class RejectedCredentialError extends AuthError {}

export class ConfigError extends BunnyError {
  override readonly name = 'ConfigError';
}

export class ValidationError extends BunnyError {
  override readonly name = 'ValidationError';
}

export class BunnyApiError extends BunnyError {
  override readonly name = 'BunnyApiError';
  readonly status: number;
  readonly errorKey: string | undefined;
  readonly field: string | undefined;

  constructor(opts: {
    message: string;
    status: number;
    errorKey?: string;
    field?: string;
  }) {
    super(opts.message);
    this.status = opts.status;
    this.errorKey = opts.errorKey;
    this.field = opts.field;
  }
}

export type BunnyErrorEnvelope = {
  ErrorKey?: string;
  Field?: string;
  Message?: string;
};

// Format an error for user-facing output. When Bunny's typed envelope is
// present (errorKey/field), include them as tags so the user can grep docs
// and pinpoint which field Bunny rejected without re-reading the request.
//
// Output shape: `[errorKey] Message (field: X) (HTTP 400)`
export function formatBunnyError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as {
      name?: string;
      message?: string;
      errorKey?: string;
      field?: string;
      status?: number;
    };
    if (e.errorKey || e.field) {
      const parts: string[] = [];
      if (e.errorKey) parts.push(`[${e.errorKey}]`);
      parts.push(e.message ?? 'unknown error');
      if (e.field) parts.push(`(field: ${e.field})`);
      if (e.status) parts.push(`(HTTP ${e.status})`);
      return parts.join(' ');
    }
    if (e.message) return e.message;
  }
  return String(err);
}

export function parseBunnyErrorBody(
  status: number,
  body: string,
): BunnyApiError {
  // Try JSON envelope first; fall back to plain-text body.
  try {
    const parsed = JSON.parse(body) as BunnyErrorEnvelope;
    if (parsed && typeof parsed === 'object') {
      return new BunnyApiError({
        message: parsed.Message ?? `HTTP ${status}`,
        status,
        errorKey: parsed.ErrorKey,
        field: parsed.Field,
      });
    }
  } catch {
    // not JSON - fall through
  }
  const trimmed = body.trim();
  return new BunnyApiError({
    message: trimmed.length > 0 ? trimmed : `HTTP ${status}`,
    status,
  });
}
