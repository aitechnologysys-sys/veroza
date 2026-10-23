/**
 * Regression tests for Facebook-linked Instagram reconnect.
 *
 * Two defects made reconnect impossible:
 *
 * 1. `generateAuthUrl` sent `.../integrations/social/instagram` while
 *    `authenticate` sent `.../integrations/social/instagram?refresh=<id>`.
 *    Meta requires the token-exchange redirect_uri to match the authorize one
 *    byte for byte, so every reconnect failed at the exchange. The reconnect
 *    target never needed to travel in the URL: the controller already stores
 *    it server-side under `refresh:<state>` in Redis and reads it back in the
 *    callback.
 *
 * 2. `reConnect` passed `findPage?.pageId!` straight through, so an account
 *    that was no longer reachable produced a request to `/undefined`.
 *
 * Reconnect (as opposed to delete-and-re-add) is what preserves the
 * integration row: the upsert key is (organizationId, internalId), and a
 * reconnect keeps internalId, so the same row — and its post history — is
 * updated in place. Delete-and-re-add cannot preserve it, because
 * checkForDeletedOnceAndUpdate randomises a soft-deleted row's internalId.
 */
import { InstagramProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.provider';

const FRONTEND = 'https://example.invalid';
const USER_TOKEN = 'SYNTHETIC-user-token-0123456789';
const PAGE_TOKEN = 'SYNTHETIC-page-token-0123456789';
const ACCOUNT_ID = '17841400000000001';
const PAGE_ID = '100000000000001';

/** Pull the decoded redirect_uri out of a Graph URL. */
const redirectUriOf = (url: string) =>
  new URL(url).searchParams.get('redirect_uri');

describe('Instagram reconnect — redirect_uri parity', () => {
  const provider = new InstagramProvider();
  let previousFrontend: string | undefined;

  beforeEach(() => {
    previousFrontend = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = FRONTEND;
  });

  afterEach(() => {
    process.env.FRONTEND_URL = previousFrontend;
    delete (global as any).fetch;
  });

  const runAuthenticate = async (refresh: string) => {
    const seen: string[] = [];
    (global as any).fetch = jest.fn(async (url: string) => {
      seen.push(url);
      return {
        json: async () => {
          if (url.includes('me/permissions')) {
            return {
              data: provider.scopes.map((permission) => ({
                permission,
                status: 'granted',
              })),
            };
          }
          if (url.includes('fields=id,name,picture')) {
            return { id: ACCOUNT_ID, name: 'Example', picture: { data: {} } };
          }
          return { access_token: PAGE_TOKEN, expires_in: 5184000 };
        },
      } as any;
    });

    await provider.authenticate({ code: 'CODE', codeVerifier: 'V', refresh });
    return seen[0];
  };

  it('sends the same redirect_uri on a first-time connect', async () => {
    const authorize = redirectUriOf((await provider.generateAuthUrl()).url);
    const exchange = redirectUriOf(await runAuthenticate(''));

    expect(exchange).toBe(authorize);
    expect(exchange).toBe(`${FRONTEND}/integrations/social/instagram`);
  });

  it('sends the same redirect_uri on a reconnect', async () => {
    const authorize = redirectUriOf((await provider.generateAuthUrl()).url);
    const exchange = redirectUriOf(await runAuthenticate(ACCOUNT_ID));

    // The whole bug: this used to gain a `?refresh=` suffix and stop matching.
    expect(exchange).toBe(authorize);
  });

  it('never leaks the reconnect target into the redirect_uri', async () => {
    const exchange = redirectUriOf(await runAuthenticate(ACCOUNT_ID));

    expect(exchange).not.toContain('refresh');
    expect(exchange).not.toContain(ACCOUNT_ID);
    expect(exchange).not.toContain('?');
  });

  it('keeps the redirect_uri free of query parameters', async () => {
    const authorize = redirectUriOf((await provider.generateAuthUrl()).url);

    // An open-redirect / URI-drift guard: anything appended here must also be
    // registered with Meta, so the value stays a bare path.
    expect(new URL(authorize!).search).toBe('');
  });
});

describe('Instagram reconnect — missing page handling', () => {
  const provider = new InstagramProvider();

  afterEach(() => jest.restoreAllMocks());

  const withPages = (pages: any[]) =>
    jest.spyOn(provider, 'pages').mockResolvedValue(pages as any);

  it('explains the failure instead of requesting /undefined', async () => {
    withPages([{ id: 'some-other-account', pageId: PAGE_ID }]);
    const page = jest.spyOn(provider, 'fetchPageInformation');

    await expect(
      provider.reConnect('root', ACCOUNT_ID, `${PAGE_TOKEN}___${USER_TOKEN}`)
    ).rejects.toThrow(/no longer available through any/i);

    expect(page).not.toHaveBeenCalled();
  });

  it.each([
    ['no pages at all', []],
    ['page entry without a pageId', [{ id: ACCOUNT_ID }]],
    ['page entry with an empty pageId', [{ id: ACCOUNT_ID, pageId: '' }]],
  ])('refuses to continue when there is %s', async (_label, pages) => {
    withPages(pages);
    const page = jest.spyOn(provider, 'fetchPageInformation');

    await expect(
      provider.reConnect('root', ACCOUNT_ID, `${PAGE_TOKEN}___${USER_TOKEN}`)
    ).rejects.toThrow();

    expect(page).not.toHaveBeenCalled();
  });

  it('preserves the account identity so the same row is updated', async () => {
    withPages([{ id: ACCOUNT_ID, pageId: PAGE_ID }]);
    jest.spyOn(provider, 'fetchPageInformation').mockResolvedValue({
      id: ACCOUNT_ID,
      name: 'Example',
      picture: '',
      access_token: `${PAGE_TOKEN}___${USER_TOKEN}`,
      username: 'example_account',
    } as any);

    const result = await provider.reConnect(
      'root',
      ACCOUNT_ID,
      `${PAGE_TOKEN}___${USER_TOKEN}`
    );

    // internalId stability is what keeps the upsert on the existing row.
    expect(result.id).toBe(ACCOUNT_ID);
  });

  it('passes the resolved page id through, never undefined', async () => {
    withPages([{ id: ACCOUNT_ID, pageId: PAGE_ID }]);
    const page = jest
      .spyOn(provider, 'fetchPageInformation')
      .mockResolvedValue({ id: ACCOUNT_ID, access_token: 'x' } as any);

    await provider.reConnect(
      'root',
      ACCOUNT_ID,
      `${PAGE_TOKEN}___${USER_TOKEN}`
    );

    expect(page).toHaveBeenCalledWith(expect.any(String), {
      id: ACCOUNT_ID,
      pageId: PAGE_ID,
    });
  });
});

describe('Instagram refreshToken contract', () => {
  const provider = new InstagramProvider();

  it('never returns a truthy access token', async () => {
    // refresh.integration.service.ts reads a falsy accessToken as "cannot
    // refresh" and flags refreshNeeded. A truthy value here would overwrite a
    // working credential with junk.
    const result = await provider.refreshToken('anything');

    expect(result.accessToken).toBeFalsy();
    expect(result.refreshToken).toBeFalsy();
  });

  it('asks for reauthorization rather than disabling the channel', async () => {
    const result = await provider.refreshToken('anything');

    // disconnectChannel only sets refreshNeeded: nothing is deleted or
    // disabled, so an expired token is recoverable by reconnecting.
    expect(result.expiresIn).toBe(0);
  });
});
