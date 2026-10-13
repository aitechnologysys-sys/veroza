/**
 * Shared redaction helpers.
 *
 * Used by the Sentry `beforeSend` gate and by provider error logging, so a
 * secret is scrubbed the same way wherever it would otherwise be written out.
 */

export const REDACTED = '[redacted]';

/** Keys whose values must never be written out, matched case-insensitively. */
export const SENSITIVE_KEY = new RegExp(
  [
    'password',
    'secret',
    'token',
    'api[_-]?key',
    'authorization',
    'signed_request',
    'client_secret',
    'refresh',
    'cookie',
    'credential',
    'code_verifier',
    'mnemonic',
  ].join('|'),
  'i'
);

/**
 * Redact `key=value` pairs for sensitive keys inside a string.
 *
 * Key-based redaction alone misses these: the value sits in a query string or
 * in free text, where the surrounding key is something harmless like `url` or
 * `message`. OAuth callbacks and HTTP client errors routinely carry `code`,
 * `access_token` or `signed_request` that way.
 *
 * The separator allows URL delimiters and whitespace, so both
 * `?access_token=…` and a bare `signed_request=…` in an error message match.
 */
export const redactSecretsInString = (value: string): string =>
  value.replace(
    /(^|[\s?&#;,(\[])((?:[\w.-]*(?:password|secret|token|api[_-]?key|authorization|signed_request|client_secret|code_verifier|credential)[\w.-]*|code))=([^&;\s"'\])]*)/gi,
    (_match, sep, key) => `${sep}${key}=${REDACTED}`
  );

/**
 * Recursively redact sensitive values in an arbitrary structure.
 */
export const redactDeep = (value: any, depth = 0): any => {
  if (depth > 8 || value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return redactSecretsInString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item, depth + 1));
  }

  if (typeof value === 'object') {
    const output: Record<string, any> = {};
    for (const [key, nested] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY.test(key)
        ? REDACTED
        : redactDeep(nested, depth + 1);
    }
    return output;
  }

  return value;
};

export interface SafeErrorSummary {
  name: string;
  message: string;
  status?: number;
  code?: string;
}

/**
 * Reduce a caught error to the parts that are safe to write out.
 *
 * Deliberately omits everything an HTTP client attaches to its errors:
 * `config` (which holds the request headers, so the Authorization token),
 * `request`, and `response.data` (the raw upstream body). What survives is
 * enough to triage — the error type, a scrubbed message, the HTTP status and
 * any transport code such as `ECONNREFUSED`.
 *
 * The stack is omitted too: frames can embed URLs carrying query-string
 * secrets, and Sentry captures stacks separately for real exceptions.
 */
export const summarizeError = (err: unknown): SafeErrorSummary => {
  const anyErr = err as any;

  const status =
    typeof anyErr?.response?.status === 'number'
      ? anyErr.response.status
      : typeof anyErr?.status === 'number'
      ? anyErr.status
      : undefined;

  const rawMessage =
    typeof anyErr?.message === 'string' ? anyErr.message : String(err ?? '');

  return {
    name: typeof anyErr?.name === 'string' ? anyErr.name : 'Error',
    // Bounded: an upstream message can be arbitrarily long.
    message: redactSecretsInString(rawMessage).slice(0, 300),
    ...(status === undefined ? {} : { status }),
    ...(typeof anyErr?.code === 'string' ? { code: anyErr.code } : {}),
  };
};

/**
 * One structured, scrubbed log line for a failure inside a provider.
 *
 * Written at `error` level so it is picked up by monitoring; the payload is
 * already safe, so forwarding it to Sentry carries nothing sensitive.
 */
export const logProviderError = (
  provider: string,
  operation: string,
  err: unknown
) => {
  console.error(
    JSON.stringify({
      event: 'provider_error',
      provider,
      operation,
      ...summarizeError(err),
    })
  );
};
