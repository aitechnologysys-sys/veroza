/**
 * Regression tests for upstream token revocation.
 *
 * Background: both implementations used the global `fetch` without checking
 * the response status. Global `fetch` only rejects on a network-level failure,
 * so every HTTP error — 400, 401, 500 — resolved normally and was
 * indistinguishable from success. The callers all log from a `catch`, so a
 * failed revocation produced no signal whatsoever. Found on live staging
 * during Phase A3b, where two revocations with deliberately invalid tokens
 * produced zero log output.
 *
 * The redaction tests are not decoration. The Facebook request URL carries the
 * token in its query string, the Google request carries it in the body, and
 * both upstreams can echo it back in an error payload. Two of the three
 * callers (integration.service.ts, deletion.service.ts) log the error object
 * itself, so anything that reaches an error message reaches the log.
 */
import { FacebookProvider } from '@gitroom/nestjs-libraries/integrations/social/facebook.provider';
import { YoutubeProvider } from '@gitroom/nestjs-libraries/integrations/social/youtube.provider';

const TOKEN = 'SYNTHETIC-must-never-be-logged-0123456789';

const mockFetch = (init: Partial<Response> | Error) => {
  const fn = jest.fn(async () => {
    if (init instanceof Error) {
      throw init;
    }
    return init as Response;
  });
  (global as any).fetch = fn;
  return fn;
};

const ok = (status: number) => ({ ok: true, status } as Partial<Response>);
const notOk = (status: number) =>
  ({
    ok: false,
    status,
    // A body that echoes the token back, which is what the upstreams do.
    text: async () => `{"error":"invalid","access_token":"${TOKEN}"}`,
    json: async () => ({ error: 'invalid', access_token: TOKEN }),
  } as Partial<Response>);

describe.each([
  ['Facebook', () => new FacebookProvider(), 'Facebook token revocation failed'],
  ['Google', () => new YoutubeProvider(), 'Google token revocation failed'],
])('%s revokeToken', (_name, make, expectedPrefix) => {
  let provider: any;

  beforeEach(() => {
    provider = make();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    delete (global as any).fetch;
  });

  describe('successful responses', () => {
    it.each([200, 204])('resolves on %i', async (status) => {
      const fetchFn = mockFetch(ok(status));
      await expect(provider.revokeToken(TOKEN)).resolves.toBeUndefined();
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('HTTP failures are treated as failures', () => {
    it.each([400, 401, 403, 500])('throws on %i', async (status) => {
      mockFetch(notOk(status));
      await expect(provider.revokeToken(TOKEN)).rejects.toThrow(
        new RegExp(`${expectedPrefix}.*${status}`)
      );
    });

    it('names the status so an operator can tell failures apart', async () => {
      mockFetch(notOk(403));
      await expect(provider.revokeToken(TOKEN)).rejects.toThrow('403');
    });
  });

  describe('network failures propagate', () => {
    it('lets a rejected fetch through to the caller', async () => {
      mockFetch(new TypeError('fetch failed'));
      await expect(provider.revokeToken(TOKEN)).rejects.toThrow('fetch failed');
    });
  });

  describe('the token never reaches an error message', () => {
    it.each([400, 401, 403, 500])(
      'omits the token, the URL and the body on %i',
      async (status) => {
        mockFetch(notOk(status));
        const error = await provider.revokeToken(TOKEN).catch((e: Error) => e);

        const serialised = `${error.message} ${error.stack ?? ''}`;
        expect(serialised).not.toContain(TOKEN);
        // The token travels inside the URL (Facebook) or the body (Google), so
        // neither may be quoted into the message.
        expect(error.message).not.toContain('access_token');
        expect(error.message).not.toContain('http');
      }
    );

    it('does not read the response body at all', async () => {
      const body = notOk(400);
      const textSpy = jest.fn(async () => `token=${TOKEN}`);
      mockFetch({ ...body, text: textSpy } as Partial<Response>);

      await provider.revokeToken(TOKEN).catch(() => undefined);

      // Never reading it is the strongest guarantee it cannot be logged.
      expect(textSpy).not.toHaveBeenCalled();
    });
  });
});

describe('best-effort contract', () => {
  afterEach(() => {
    delete (global as any).fetch;
  });

  it('throws rather than resolving, so callers can log the failure', async () => {
    // The whole point of the fix: before it, this resolved and the callers'
    // catch blocks were unreachable for an HTTP error.
    mockFetch(notOk(400));
    const provider: any = new FacebookProvider();

    let caught: unknown;
    try {
      await provider.revokeToken(TOKEN);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
  });
});
