/**
 * Regression tests for the OAuth callback's handling of a reconnect.
 *
 * The reconnect target reaches the callback twice: once as the server-side
 * state entry `refresh:<state>` in Redis (written when the reconnect was
 * started), and once as `body.refresh`, echoed back through the provider's
 * redirect URI. Only the first is trustworthy — the second is client-supplied,
 * and once Instagram stopped appending `?refresh=` to its redirect URI (which
 * it had to, because the value made the token-exchange URI differ from the
 * authorize URI) it stopped arriving at all.
 *
 * Two consequences were fixed here:
 *   - `refreshToken` was being filled with `body.refresh`, storing an account
 *     identifier in the refresh-token column.
 *   - the upsert's `refresh` argument came from `body.refresh`, so whether an
 *     integration was treated as a reconnect depended on a query parameter.
 */
const redis = {
  get: jest.fn(),
  del: jest.fn(),
  set: jest.fn(),
};

jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: redis,
}));

import { NoAuthIntegrationsController } from '@gitroom/backend/api/routes/no.auth.integrations.controller';

const STATE = 'STATE123';
const ORG = { id: 'org-1', isTrailing: false };
const ACCOUNT_ID = '17841400000000001';
const OTHER_ACCOUNT_ID = '17841400000009999';
const PROVIDER_REFRESH_TOKEN = 'SYNTHETIC-provider-refresh-token';

/** Redis contents for one run, keyed exactly as the controller reads them. */
const givenState = (entries: Record<string, string | null>) => {
  redis.get.mockImplementation(async (key: string) => entries[key] ?? null);
  redis.del.mockResolvedValue(1);
};

const buildController = (provider: any) => {
  const createOrUpdateIntegration = jest.fn(async () => ({ id: 'row-1' }));
  const controller = new NoAuthIntegrationsController(
    {
      getAllowedSocialsIntegrations: () => ['instagram'],
      getSocialIntegration: () => provider,
    } as any,
    {
      createOrUpdateIntegration,
      checkPreviousConnections: jest.fn(async () => false),
    } as any,
    { startRefreshWorkflow: jest.fn(async () => undefined) } as any,
    { getOrgById: jest.fn(async () => ORG) } as any
  );

  return { controller, createOrUpdateIntegration };
};

const instagramLike = (overrides: any = {}) => ({
  isBetweenSteps: true,
  customFields: undefined,
  externalUrl: undefined,
  oneTimeToken: false,
  customInstanceDetails: undefined,
  isChromeExtension: false,
  authenticate: jest.fn(async () => ({
    id: ACCOUNT_ID,
    name: 'Example',
    accessToken: 'SYNTHETIC-access',
    refreshToken: PROVIDER_REFRESH_TOKEN,
    expiresIn: 5184000,
    picture: '',
    username: 'example_account',
  })),
  reConnect: jest.fn(async () => ({
    id: ACCOUNT_ID,
    name: 'Example',
    accessToken: 'SYNTHETIC-access',
    picture: '',
    username: 'example_account',
  })),
  ...overrides,
});

const callbackBody = (extra: any = {}) => ({
  state: STATE,
  code: 'CODE',
  timezone: '0',
  ...extra,
});

/** Positional arguments of createOrUpdateIntegration that this suite asserts. */
const ARG = { internalId: 6, refreshToken: 9, isBetweenSteps: 12, refresh: 13 };

beforeEach(() => jest.clearAllMocks());

describe('OAuth callback — reconnect uses server-side state', () => {
  it('treats it as a reconnect from Redis alone, with no query parameter', async () => {
    const provider = instagramLike();
    const { controller, createOrUpdateIntegration } = buildController(provider);

    givenState({
      [`login:${STATE}`]: 'verifier',
      [`organization:${STATE}`]: ORG.id,
      [`refresh:${STATE}`]: ACCOUNT_ID,
    });

    // Note: no `refresh` on the body at all — this is the post-fix reality.
    await controller.connectSocialMedia('instagram', callbackBody() as any);

    const args = createOrUpdateIntegration.mock.calls[0] as any[];
    expect(args[ARG.refresh]).toBe(ACCOUNT_ID);
    expect(provider.reConnect).toHaveBeenCalled();
  });

  it('ignores a body.refresh that the server-side state does not corroborate', async () => {
    const provider = instagramLike();
    const { controller, createOrUpdateIntegration } = buildController(provider);

    givenState({
      [`login:${STATE}`]: 'verifier',
      [`organization:${STATE}`]: ORG.id,
      // no refresh:<state> — this was NOT started as a reconnect
    });

    await controller.connectSocialMedia(
      'instagram',
      callbackBody({ refresh: OTHER_ACCOUNT_ID }) as any
    );

    // A forged query parameter must not turn a fresh connect into a reconnect.
    const args = createOrUpdateIntegration.mock.calls[0] as any[];
    expect(args[ARG.refresh]).toBeUndefined();
    expect(provider.reConnect).not.toHaveBeenCalled();
  });

  it('refuses to update an unrelated integration', async () => {
    // The authenticated account differs from the one being reconnected.
    const provider = instagramLike({
      authenticate: jest.fn(async () => ({
        id: OTHER_ACCOUNT_ID,
        name: 'Someone else',
        accessToken: 'SYNTHETIC-access',
        refreshToken: PROVIDER_REFRESH_TOKEN,
        picture: '',
        username: 'someone_else',
      })),
      reConnect: undefined,
    });
    const { controller, createOrUpdateIntegration } = buildController(provider);

    givenState({
      [`login:${STATE}`]: 'verifier',
      [`organization:${STATE}`]: ORG.id,
      [`refresh:${STATE}`]: ACCOUNT_ID,
    });

    // NotEnoughScopes is a plain class, not an Error subclass, so the
    // rejection value has to be matched structurally rather than with
    // .toThrow().
    await expect(
      controller.connectSocialMedia('instagram', callbackBody() as any)
    ).rejects.toMatchObject({
      message: expect.stringMatching(
        /refresh the channel that needs to be refreshed/i
      ),
    });

    expect(createOrUpdateIntegration).not.toHaveBeenCalled();
  });

  it('passes the existing account id through unchanged, so the same row is updated', async () => {
    const provider = instagramLike();
    const { controller, createOrUpdateIntegration } = buildController(provider);

    givenState({
      [`login:${STATE}`]: 'verifier',
      [`organization:${STATE}`]: ORG.id,
      [`refresh:${STATE}`]: ACCOUNT_ID,
    });

    await controller.connectSocialMedia('instagram', callbackBody() as any);

    // internalId is the upsert key with organizationId; keeping it stable is
    // what preserves the integration row and its post history.
    const args = createOrUpdateIntegration.mock.calls[0] as any[];
    expect(String(args[ARG.internalId])).toBe(ACCOUNT_ID);
  });
});

describe('OAuth callback — refreshToken column', () => {
  it('stores the provider refresh token, not the integration id', async () => {
    const provider = instagramLike();
    const { controller, createOrUpdateIntegration } = buildController(provider);

    givenState({
      [`login:${STATE}`]: 'verifier',
      [`organization:${STATE}`]: ORG.id,
      [`refresh:${STATE}`]: ACCOUNT_ID,
    });

    await controller.connectSocialMedia('instagram', callbackBody() as any);

    const args = createOrUpdateIntegration.mock.calls[0] as any[];
    expect(args[ARG.refreshToken]).toBe(PROVIDER_REFRESH_TOKEN);
    expect(args[ARG.refreshToken]).not.toBe(ACCOUNT_ID);
  });

  it('keeps the provider refresh token on a first-time connect too', async () => {
    const provider = instagramLike();
    const { controller, createOrUpdateIntegration } = buildController(provider);

    givenState({
      [`login:${STATE}`]: 'verifier',
      [`organization:${STATE}`]: ORG.id,
    });

    await controller.connectSocialMedia('instagram', callbackBody() as any);

    const args = createOrUpdateIntegration.mock.calls[0] as any[];
    expect(args[ARG.refreshToken]).toBe(PROVIDER_REFRESH_TOKEN);
  });
});

describe('OAuth callback — inBetweenSteps', () => {
  it('keeps the page-picker step for a first-time connect', async () => {
    const provider = instagramLike();
    const { controller, createOrUpdateIntegration } = buildController(provider);

    givenState({
      [`login:${STATE}`]: 'verifier',
      [`organization:${STATE}`]: ORG.id,
    });

    await controller.connectSocialMedia('instagram', callbackBody() as any);

    const args = createOrUpdateIntegration.mock.calls[0] as any[];
    expect(args[ARG.isBetweenSteps]).toBe(true);
  });

  it('skips the page-picker step on a reconnect', async () => {
    const provider = instagramLike();
    const { controller, createOrUpdateIntegration } = buildController(provider);

    givenState({
      [`login:${STATE}`]: 'verifier',
      [`organization:${STATE}`]: ORG.id,
      [`refresh:${STATE}`]: ACCOUNT_ID,
    });

    await controller.connectSocialMedia('instagram', callbackBody() as any);

    // reConnect already resolved the page, so the user must not be asked again.
    const args = createOrUpdateIntegration.mock.calls[0] as any[];
    expect(args[ARG.isBetweenSteps]).toBe(false);
  });
});

describe('OAuth callback — state validation and consumption', () => {
  it('rejects a state with no stored code verifier', async () => {
    const { controller, createOrUpdateIntegration } = buildController(
      instagramLike()
    );

    givenState({ [`organization:${STATE}`]: ORG.id });

    await expect(
      controller.connectSocialMedia('instagram', callbackBody() as any)
    ).rejects.toThrow(/invalid state/i);

    expect(createOrUpdateIntegration).not.toHaveBeenCalled();
  });

  it('rejects a state with no organization', async () => {
    const { controller, createOrUpdateIntegration } = buildController(
      instagramLike()
    );

    givenState({ [`login:${STATE}`]: 'verifier' });

    await expect(
      controller.connectSocialMedia('instagram', callbackBody() as any)
    ).rejects.toThrow(/organization not found/i);

    expect(createOrUpdateIntegration).not.toHaveBeenCalled();
  });

  it('consumes the login and refresh state so it cannot be replayed', async () => {
    const { controller } = buildController(instagramLike());

    givenState({
      [`login:${STATE}`]: 'verifier',
      [`organization:${STATE}`]: ORG.id,
      [`refresh:${STATE}`]: ACCOUNT_ID,
    });

    await controller.connectSocialMedia('instagram', callbackBody() as any);

    const deleted = redis.del.mock.calls.map(([key]) => key);
    expect(deleted).toEqual(expect.arrayContaining([`login:${STATE}`]));
    expect(deleted).toEqual(expect.arrayContaining([`refresh:${STATE}`]));
  });

  it('rejects an integration that is not an allowed social', async () => {
    const { controller } = buildController(instagramLike());

    await expect(
      controller.connectSocialMedia('not-a-provider', callbackBody() as any)
    ).rejects.toThrow(/not allowed/i);
  });
});

describe('OAuth callback — failed callbacks never partially update', () => {
  const validState = {
    [`login:${STATE}`]: 'verifier',
    [`organization:${STATE}`]: ORG.id,
    [`refresh:${STATE}`]: ACCOUNT_ID,
  };

  it('writes nothing when the provider reports an error string', async () => {
    const provider = instagramLike({
      authenticate: jest.fn(async () => 'invalid_grant'),
      reConnect: undefined,
    });
    const { controller, createOrUpdateIntegration } = buildController(provider);
    givenState(validState);

    await expect(
      controller.connectSocialMedia('instagram', callbackBody() as any)
    ).rejects.toMatchObject({ message: expect.any(String) });

    expect(createOrUpdateIntegration).not.toHaveBeenCalled();
  });

  it('writes nothing when the provider returns no account id', async () => {
    const provider = instagramLike({
      authenticate: jest.fn(async () => ({
        id: '',
        name: '',
        accessToken: '',
        refreshToken: '',
        picture: '',
        username: '',
      })),
      reConnect: undefined,
    });
    const { controller, createOrUpdateIntegration } = buildController(provider);
    givenState(validState);

    await expect(
      controller.connectSocialMedia('instagram', callbackBody() as any)
    ).rejects.toMatchObject({
      message: expect.stringMatching(/invalid api key/i),
    });

    expect(createOrUpdateIntegration).not.toHaveBeenCalled();
  });

  it('writes nothing when reConnect throws', async () => {
    const provider = instagramLike({
      reConnect: jest.fn(async () => {
        throw new Error('no longer available through any Facebook page');
      }),
    });
    const { controller, createOrUpdateIntegration } = buildController(provider);
    givenState(validState);

    await expect(
      controller.connectSocialMedia('instagram', callbackBody() as any)
    ).rejects.toMatchObject({
      message: expect.stringMatching(/no longer available/i),
    });

    expect(createOrUpdateIntegration).not.toHaveBeenCalled();
  });
});
