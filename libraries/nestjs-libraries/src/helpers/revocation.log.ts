/**
 * One structured, credential-free line for a failed upstream token revocation.
 *
 * Both call sites previously logged the caught error object directly
 * (`console.error(msg, err)`), which prints the whole chain: an HTTP client
 * attaches the request URL, the headers and the upstream response body to its
 * errors, and `cause` nests another error doing the same. The Facebook
 * revocation URL carries the access token in its query string, so that path
 * could write a live credential into the logs.
 *
 * Every emitted value is **allowlisted and bounded**. Nothing is copied out of
 * the error because it merely looked like the right type:
 *
 *   status     an integer, and only inside the valid HTTP range
 *   code       only a transport code this file names explicitly
 *   errorType  only a standard error class name, else `Other`
 *   ids        matched against a conservative character/length pattern
 *
 * `message`, `stack`, `cause`, `config`, `request` and `response` are never
 * read. `err.name` and `err.code` are attacker- or library-controlled strings,
 * so they are compared against a fixed set rather than serialised: an error
 * can carry `name = "<4KB of response body>"` just as easily as `"TypeError"`.
 *
 * Shared rather than inlined at both call sites on purpose: duplicated
 * security logic is how the original defect escaped — `revokeToken` was fixed
 * in `facebook.provider.ts` while the identical bug sat in
 * `youtube.provider.ts`.
 */

/** Transport-level failures worth distinguishing. Anything else is `unknown`. */
const TRANSPORT_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'ENOTFOUND',
  'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'EPROTO',
  'ERR_SOCKET_CONNECTION_TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
  'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/** Error class names that may be echoed verbatim. */
const ERROR_TYPES = new Set([
  'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError',
  'URIError', 'EvalError', 'AggregateError', 'AbortError', 'DOMException',
  'FetchError',
]);

/** Our own identifiers: cuid/uuid shaped, never free text. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_PROVIDER = /^[a-z0-9-]{1,32}$/;

const safeStatus = (err: any): number | undefined => {
  const raw = typeof err?.status === 'number' ? err.status : undefined;
  return Number.isInteger(raw) && raw >= 100 && raw <= 599 ? raw : undefined;
};

const safeCode = (err: any): string | undefined =>
  typeof err?.code === 'string' && TRANSPORT_CODES.has(err.code)
    ? err.code
    : undefined;

const safeErrorType = (err: any): string =>
  typeof err?.name === 'string' && ERROR_TYPES.has(err.name) ? err.name : 'Other';

export const logRevocationFailure = (
  integration: { id: string; providerIdentifier?: string },
  err: unknown
): void => {
  const status = safeStatus(err);
  const code = safeCode(err);

  const category = status !== undefined
    ? 'upstream_rejected'
    : code !== undefined
    ? 'network'
    : 'unknown';

  const id = SAFE_ID.test(integration?.id ?? '') ? integration.id : '(unloggable)';
  const provider =
    integration?.providerIdentifier &&
    SAFE_PROVIDER.test(integration.providerIdentifier)
      ? integration.providerIdentifier
      : undefined;

  console.error(
    JSON.stringify({
      event: 'upstream_revocation_failed',
      integrationId: id,
      ...(provider ? { provider } : {}),
      category,
      ...(status !== undefined ? { status } : {}),
      ...(code !== undefined ? { code } : {}),
      errorType: safeErrorType(err),
    })
  );
};
