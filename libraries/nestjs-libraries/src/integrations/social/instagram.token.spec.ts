/**
 * Regression tests for the Facebook-linked Instagram credential bug.
 *
 * Background: `fetchPageInformation` destructured `access_token` out of the
 * Graph Page response and concatenated it into the stored credential without
 * checking it existed. Graph omits that field whenever the user cannot manage
 * the Page, so the integration was saved with the literal string
 * `undefined___<user token>`. The connect reported success. The failure only
 * appeared at publish time, when Meta rejected the request with code 190,
 * "Invalid OAuth access token - Cannot parse access token".
 *
 * It was then misreported: `handleErrors` matched the substring `'190,'` and
 * returned "The account is missing some permissions", sending people to audit
 * scopes that were never the problem. That substring also matched unrelated
 * subcodes such as 2207190.
 *
 * Observed on staging 2026-10-20: integration token length 204, separator at
 * position 10, first nine characters `undefined`.
 */
import { InstagramProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.provider';

const USER_TOKEN = 'SYNTHETIC-user-token-must-never-leak-0123456789';
const PAGE_TOKEN = 'SYNTHETIC-page-token-0123456789';

const queueResponses = (...bodies: any[]) => {
  const fn = jest.fn(async () => {
    const body = bodies.shift();
    return { json: async () => body } as any;
  });
  (global as any).fetch = fn;
  return fn;
};

describe('InstagramProvider.fetchPageInformation', () => {
  const provider = new InstagramProvider();
  const target = { pageId: '100000000000001', id: '17841400000000001' };

  afterEach(() => {
    delete (global as any).fetch;
  });

  it('stores page___user when Graph returns a page token', async () => {
    queueResponses(
      { access_token: PAGE_TOKEN, name: 'Example Page' },
      {
        id: target.id,
        name: 'Example Page',
        username: 'example_account',
        profile_picture_url: 'https://example.invalid/p.jpg',
      }
    );

    const result = await provider.fetchPageInformation(USER_TOKEN, target);

    expect(result.access_token).toBe(`${PAGE_TOKEN}___${USER_TOKEN}`);
    expect(result.username).toBe('example_account');
  });

  // The exact shapes Graph returns when the Page is not manageable.
  it.each([
    ['field absent', { name: 'Example Page' }],
    ['explicit undefined', { access_token: undefined, name: 'Example Page' }],
    ['null', { access_token: null }],
    ['empty string', { access_token: '' }],
    ['non-string', { access_token: 12345 }],
    ['error payload', { error: { message: 'x', code: 190, type: 'OAuthException' } }],
    ['empty object', {}],
    ['null body', null],
  ])('throws instead of storing undefined___ when %s', async (_label, body) => {
    queueResponses(body, { id: target.id });

    await expect(
      provider.fetchPageInformation(USER_TOKEN, target)
    ).rejects.toThrow(/did not return an access token/i);
  });

  it('never produces a credential beginning with "undefined"', async () => {
    queueResponses({ name: 'Example Page' }, { id: target.id });

    let stored: string | undefined;
    try {
      stored = (await provider.fetchPageInformation(USER_TOKEN, target))
        .access_token;
    } catch {
      stored = undefined;
    }

    expect(stored).toBeUndefined();
    expect(stored ?? '').not.toContain('undefined___');
  });

  it('does not call the Instagram lookup once the page token is missing', async () => {
    const fetchMock = queueResponses({ name: 'Example Page' }, { id: target.id });

    await expect(
      provider.fetchPageInformation(USER_TOKEN, target)
    ).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('names the page and stays actionable without leaking the token', async () => {
    queueResponses({ error: { code: 190, error_subcode: 463 } }, {});

    const error = await provider
      .fetchPageInformation(USER_TOKEN, target)
      .catch((e: Error) => e);

    const message = (error as Error).message;
    expect(message).toContain(target.pageId);
    expect(message).toContain('connect the channel again');
    expect(message).toContain('Facebook error code 190, subcode 463');
    expect(message).not.toContain(USER_TOKEN);
  });

  it('omits the error suffix when Graph reports no numeric code', async () => {
    queueResponses({ error: { message: 'something' } }, {});

    const error = await provider
      .fetchPageInformation(USER_TOKEN, target)
      .catch((e: Error) => e);

    expect((error as Error).message).not.toContain('Facebook error code');
  });
});

describe('InstagramProvider.handleErrors — code 190 classification', () => {
  const provider = new InstagramProvider();
  const graph = (error: Record<string, unknown>) => JSON.stringify({ error });

  it('routes a malformed token to reauthorization, not a silent failure', () => {
    const result = provider.handleErrors(
      graph({
        message: 'Invalid OAuth access token - Cannot parse access token',
        type: 'OAuthException',
        code: 190,
      }),
      400
    );

    // This provider sets canRefreshToken = false, so refresh.integration
    // .service skips the exchange entirely and flags the channel instead —
    // no request is spent retrying a value that is not a token. Classifying
    // this as bad-body left refreshNeeded unset, so the UI offered no
    // reconnect and users were pushed into delete-and-re-add.
    expect(provider.canRefreshToken).toBe(false);
    expect(result?.type).toBe('refresh-token');
    expect(result?.value).toMatch(/reconnect the channel/i);
  });

  it.each([463, 467])(
    'treats genuinely expired tokens (subcode %s) as refreshable',
    (subcode) => {
      const result = provider.handleErrors(
        graph({ message: 'expired', code: 190, error_subcode: subcode }),
        400
      );

      expect(result?.type).toBe('refresh-token');
      expect(result?.value).toMatch(/expired/i);
    }
  );

  it('no longer blames permissions for a token failure', () => {
    const result = provider.handleErrors(graph({ code: 190 }), 400);

    expect(result?.value).not.toMatch(/missing some permissions/i);
  });

  it('does not match an unrelated subcode that merely contains "190,"', () => {
    // The old substring test fired on this body because the serialized
    // subcode 2207190 is followed by a comma.
    const result = provider.handleErrors(
      graph({ message: 'Fatal', code: -1, error_subcode: 2207190 }),
      400
    );

    // Falling through (undefined) is correct: it is not a 190 at all.
    expect(result?.value ?? '').not.toMatch(/reconnect the channel/i);
    expect(result?.value ?? '').not.toMatch(/expired/i);
  });

  it('ignores a bare 190 that is not a Graph error code', () => {
    const result = provider.handleErrors(
      JSON.stringify({ error: { message: 'resolution 1190, too small', code: 1 } }),
      400
    );

    expect(result?.value ?? '').not.toMatch(/reconnect the channel/i);
  });

  it('falls through safely on a non-JSON body', () => {
    expect(() => provider.handleErrors('<html>502 Bad Gateway</html>', 502)).not.toThrow();
  });

  it('leaves unrelated Instagram errors classified as before', () => {
    expect(provider.handleErrors(graph({ code: 36003 }), 400)?.value).toMatch(
      /aspect ratio/i
    );
    expect(
      provider.handleErrors(graph({ error_subcode: 2207001 }), 400)?.value
    ).toMatch(/spam/i);
  });
});
