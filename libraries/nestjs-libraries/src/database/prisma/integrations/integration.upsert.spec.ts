/**
 * Regression tests for the integration upsert's update branch.
 *
 * Two fields were written in a way that could damage a healthy row:
 *
 *   - `inBetweenSteps` was skipped entirely whenever `refresh` was set, so a
 *     row already sitting at `true` stayed there after a successful reconnect
 *     and the page picker reappeared. Callers already compute the right value
 *     (`refresh ? false : provider.isBetweenSteps`), so it is now always
 *     persisted.
 *   - `refreshToken` was written unconditionally. A reconnect carries no
 *     refresh token of its own, and some providers return an empty one, so a
 *     valid stored token could be blanked out. It is now written only when a
 *     value is actually present.
 *
 * The upsert key is (organizationId, internalId): keeping those stable is what
 * preserves the integration row id, and with it every post that references it.
 */
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';

const ORG = 'org-1';
const ACCOUNT_ID = '17841400000000001';
const EXISTING_ROW = 'row-1';
const PROVIDER_REFRESH_TOKEN = 'SYNTHETIC-provider-refresh-token';

const buildRepository = () => {
  const upsert = jest.fn(async () => ({ id: EXISTING_ROW }));
  const model = {
    model: {
      integration: {
        upsert,
        findFirst: jest.fn(async () => ({ rootInternalId: ACCOUNT_ID })),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
    },
  };

  const repository = new IntegrationRepository(
    model as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );

  return { repository, upsert };
};

/**
 * Mirrors the positional call made by the OAuth callback.
 * `isBetweenSteps` and `refresh` are what the controller computes.
 */
const callUpsert = (
  repository: IntegrationRepository,
  options: {
    refreshToken?: string;
    isBetweenSteps?: boolean;
    refresh?: string;
  } = {}
) => {
  // Presence check, not a default: passing an explicit `undefined` has to stay
  // `undefined` so it exercises the signature's own `refreshToken = ''`
  // default, exactly as a real caller would.
  const refreshToken =
    'refreshToken' in options ? options.refreshToken : PROVIDER_REFRESH_TOKEN;
  const { isBetweenSteps = false, refresh = undefined } = options;

  return repository.createOrUpdateIntegration(
    undefined,
    false,
    ORG,
    'Example',
    undefined,
    'social',
    ACCOUNT_ID,
    'instagram',
    'SYNTHETIC-access-token',
    refreshToken,
    5184000,
    'example_account',
    isBetweenSteps,
    refresh
  );
};

describe('integration upsert — inBetweenSteps', () => {
  it('clears the flag on a reconnect even if the row had it set', async () => {
    const { repository, upsert } = buildRepository();

    // A reconnect: controller passes refresh=<internalId> and false.
    await callUpsert(repository, { isBetweenSteps: false, refresh: ACCOUNT_ID });

    expect(upsert.mock.calls[0][0].update.inBetweenSteps).toBe(false);
  });

  it('sets the flag on a first-time connect to a two-step provider', async () => {
    const { repository, upsert } = buildRepository();

    await callUpsert(repository, { isBetweenSteps: true, refresh: undefined });

    expect(upsert.mock.calls[0][0].update.inBetweenSteps).toBe(true);
  });

  it('always writes the field rather than leaving it to drift', async () => {
    const { repository, upsert } = buildRepository();

    await callUpsert(repository, { isBetweenSteps: false, refresh: ACCOUNT_ID });

    expect(upsert.mock.calls[0][0].update).toHaveProperty('inBetweenSteps');
  });
});

describe('integration upsert — refreshToken preservation', () => {
  it('writes a refresh token when the provider returned one', async () => {
    const { repository, upsert } = buildRepository();

    await callUpsert(repository, { refreshToken: PROVIDER_REFRESH_TOKEN });

    expect(upsert.mock.calls[0][0].update.refreshToken).toBe(
      PROVIDER_REFRESH_TOKEN
    );
  });

  it.each([
    ['an empty string', ''],
    ['undefined', undefined],
  ])('leaves the stored token alone when the provider returned %s', async (
    _label,
    value
  ) => {
    const { repository, upsert } = buildRepository();

    await callUpsert(repository, {
      refreshToken: value as any,
      refresh: ACCOUNT_ID,
    });

    // Absent key => Prisma does not touch the column.
    expect(upsert.mock.calls[0][0].update).not.toHaveProperty('refreshToken');
  });

  it('still seeds the column when the row is created', async () => {
    const { repository, upsert } = buildRepository();

    await callUpsert(repository, { refreshToken: '' });

    expect(upsert.mock.calls[0][0].create).toHaveProperty('refreshToken');
  });
});

describe('integration upsert — row identity and metadata', () => {
  it('keys on organizationId + internalId so the same row is updated', async () => {
    const { repository, upsert } = buildRepository();

    await callUpsert(repository, { refresh: ACCOUNT_ID });

    expect(upsert.mock.calls[0][0].where).toEqual({
      organizationId_internalId: {
        internalId: ACCOUNT_ID,
        organizationId: ORG,
      },
    });
  });

  it('keeps the account id stable across a reconnect', async () => {
    const { repository, upsert } = buildRepository();

    await callUpsert(repository, { refresh: ACCOUNT_ID });

    expect(upsert.mock.calls[0][0].update.internalId).toBe(ACCOUNT_ID);
  });

  it('revives the row and clears the reauthorization flag', async () => {
    const { repository, upsert } = buildRepository();

    await callUpsert(repository, { refresh: ACCOUNT_ID });

    const update = upsert.mock.calls[0][0].update;
    expect(update.deletedAt).toBeNull();
    expect(update.refreshNeeded).toBe(false);
  });

  it('never rewrites rootInternalId on update, so post history stays attached', async () => {
    const { repository, upsert } = buildRepository();

    await callUpsert(repository, { refresh: ACCOUNT_ID });

    expect(upsert.mock.calls[0][0].update).not.toHaveProperty('rootInternalId');
  });
});
