/**
 * Pins the YouTube OAuth scope set submitted for Google verification.
 *
 * The provider's `scopes` array feeds both the consent URL and the
 * `checkScopes` gate in `authenticate`, so a change to it changes what users
 * are asked for and what they must grant. The broad youtube, youtube.force-ssl
 * and youtubepartner scopes were removed because no implemented call needs
 * them; requesting them again would reopen the verification review.
 */
// The provider imports class-transformer DTOs, whose decorators need this
// polyfill; Nest loads it at runtime, a bare test does not.
import 'reflect-metadata';
import { google } from 'googleapis';
import { YoutubeProvider } from '@gitroom/nestjs-libraries/integrations/social/youtube.provider';
import { NotEnoughScopes } from '@gitroom/nestjs-libraries/integrations/social.abstract';

const RETAINED = [
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
];

const REMOVED = [
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/youtubepartner',
];

const OAuth2 = google.auth.OAuth2.prototype as any;

const mockGrant = (granted: string[]) => {
  jest.spyOn(OAuth2, 'getToken').mockResolvedValue({
    tokens: {
      access_token: 'SYNTHETIC-access',
      refresh_token: 'SYNTHETIC-refresh',
      expiry_date: Date.now() + 3600_000,
    },
  });
  jest.spyOn(OAuth2, 'getTokenInfo').mockResolvedValue({ scopes: granted });
  jest.spyOn(google, 'oauth2').mockReturnValue({
    userinfo: {
      get: jest.fn().mockResolvedValue({
        data: { id: 'google-id', name: 'Channel Owner', picture: 'pic' },
      }),
    },
  } as any);
};

describe('YoutubeProvider OAuth scopes', () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env.YOUTUBE_CLIENT_ID = 'test-client-id';
    process.env.YOUTUBE_CLIENT_SECRET = 'test-client-secret';
    process.env.FRONTEND_URL = 'https://app.example.test';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...env };
  });

  it('declares exactly the five retained scopes', () => {
    expect(new YoutubeProvider().scopes).toEqual(RETAINED);
  });

  describe('generateAuthUrl', () => {
    const requested = async () => {
      const { url } = await new YoutubeProvider().generateAuthUrl();
      return new URL(url).searchParams.get('scope')!.split(' ');
    };

    it('requests exactly the five retained scopes', async () => {
      expect((await requested()).sort()).toEqual([...RETAINED].sort());
    });

    it.each(REMOVED)('no longer requests %s', async (scope) => {
      expect(await requested()).not.toContain(scope);
    });

    it('keeps the redirect URI and offline consent unchanged', async () => {
      const { url } = await new YoutubeProvider().generateAuthUrl();
      const params = new URL(url).searchParams;
      expect(params.get('redirect_uri')).toBe(
        'https://app.example.test/integrations/social/youtube'
      );
      expect(params.get('access_type')).toBe('offline');
      expect(params.get('prompt')).toBe('consent');
    });
  });

  describe('authenticate', () => {
    const connect = () =>
      new YoutubeProvider().authenticate({ code: 'code', codeVerifier: 'v' });

    it('accepts a grant of the five retained scopes', async () => {
      mockGrant(RETAINED);
      await expect(connect()).resolves.toMatchObject({
        accessToken: 'SYNTHETIC-access',
        refreshToken: 'SYNTHETIC-refresh',
        id: 'google-id',
        name: 'Channel Owner',
      });
    });

    it('accepts a grant that also carries the old broad scopes', async () => {
      mockGrant([...RETAINED, ...REMOVED]);
      await expect(connect()).resolves.toMatchObject({ id: 'google-id' });
    });

    it.each(RETAINED)('rejects a grant missing %s', async (missing) => {
      mockGrant(RETAINED.filter((s) => s !== missing));
      await expect(connect()).rejects.toBeInstanceOf(NotEnoughScopes);
    });
  });

  it('refreshes a token without re-validating scopes', async () => {
    jest.spyOn(OAuth2, 'refreshAccessToken').mockResolvedValue({
      credentials: {
        access_token: 'SYNTHETIC-new-access',
        expiry_date: Date.now() + 3600_000,
      },
    });
    const getTokenInfo = jest.spyOn(OAuth2, 'getTokenInfo');
    mockGrant(RETAINED);

    await expect(
      new YoutubeProvider().refreshToken('SYNTHETIC-refresh')
    ).resolves.toMatchObject({
      accessToken: 'SYNTHETIC-new-access',
      refreshToken: 'SYNTHETIC-refresh',
    });
    expect(getTokenInfo).not.toHaveBeenCalled();
  });
});
