/**
 * Regression tests for the line between an automatic token refresh and an
 * interactive OAuth reauthorization.
 *
 * Instagram via Facebook has no refresh grant: the stored page token can only
 * be replaced by a fresh authorization. The service used to call
 * `refreshToken()` anyway, which for that provider is a stub returning an
 * empty access token — a request spent to fail, and a failure indistinguishable
 * from a genuine refresh error.
 *
 * `canRefreshToken = false` makes the distinction explicit: the exchange is
 * skipped and the channel is flagged so the UI offers "reconnect". That
 * matters beyond tidiness — on 2026-10-21 a malformed Instagram credential
 * never set `refreshNeeded`, so no reconnect button appeared and the only
 * visible route was delete-and-re-add, which randomises the old row's
 * internalId and detaches its post history.
 */
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';

const INTEGRATION = {
  id: 'row-1',
  organizationId: 'org-1',
  internalId: '17841400000000001',
  providerIdentifier: 'instagram',
  name: 'Example',
  picture: '',
  refreshToken: 'SYNTHETIC-stored-refresh-token',
} as any;

const buildService = (provider: any) => {
  const integrationService = {
    refreshNeeded: jest.fn(async () => undefined),
    informAboutRefreshError: jest.fn(async () => undefined),
    disconnectChannel: jest.fn(async () => undefined),
    createOrUpdateIntegration: jest.fn(async () => ({ id: 'row-1' })),
  };

  const service = new RefreshIntegrationService(
    { getSocialIntegration: () => provider } as any,
    integrationService as any,
    {} as any
  );

  return { service, integrationService };
};

const refreshableProvider = () => ({
  identifier: 'threads',
  canRefreshToken: true,
  oneTimeToken: false,
  refreshToken: jest.fn(async () => ({
    accessToken: 'SYNTHETIC-fresh-token',
    refreshToken: 'SYNTHETIC-fresh-refresh',
    expiresIn: 5184000,
    id: '1',
    name: 'Example',
    picture: '',
    username: 'example',
  })),
});

const nonRefreshableProvider = () => ({
  identifier: 'instagram',
  canRefreshToken: false,
  oneTimeToken: false,
  // Present but must never be called.
  refreshToken: jest.fn(async () => ({
    accessToken: '',
    refreshToken: '',
    expiresIn: 0,
    id: '',
    name: '',
    picture: '',
    username: '',
  })),
});

describe('refresh — providers that cannot refresh', () => {
  it('never attempts an exchange', async () => {
    const provider = nonRefreshableProvider();
    const { service } = buildService(provider);

    await service.refresh(INTEGRATION);

    expect(provider.refreshToken).not.toHaveBeenCalled();
  });

  it('flags the channel so the UI offers a reconnect', async () => {
    const provider = nonRefreshableProvider();
    const { service, integrationService } = buildService(provider);

    await service.refresh(INTEGRATION);

    expect(integrationService.refreshNeeded).toHaveBeenCalledWith(
      'org-1',
      'row-1'
    );
    // disconnectChannel only sets refreshNeeded; nothing is deleted or disabled.
    expect(integrationService.disconnectChannel).toHaveBeenCalled();
  });

  it('tells the user, and returns false rather than a broken credential', async () => {
    const provider = nonRefreshableProvider();
    const { service, integrationService } = buildService(provider);

    const result = await service.refresh(INTEGRATION);

    expect(result).toBe(false);
    expect(integrationService.informAboutRefreshError).toHaveBeenCalled();
  });

  it('never writes a credential when it cannot refresh', async () => {
    const provider = nonRefreshableProvider();
    const { service, integrationService } = buildService(provider);

    await service.refresh(INTEGRATION);

    expect(integrationService.createOrUpdateIntegration).not.toHaveBeenCalled();
  });
});

describe('refresh — providers that can refresh', () => {
  it('still performs the exchange', async () => {
    const provider = refreshableProvider();
    const { service } = buildService(provider);

    await service.refresh(INTEGRATION);

    expect(provider.refreshToken).toHaveBeenCalledWith(
      'SYNTHETIC-stored-refresh-token'
    );
  });

  it('does not flag the channel for reconnection on success', async () => {
    const provider = refreshableProvider();
    const { service, integrationService } = buildService(provider);

    await service.refresh(INTEGRATION);

    expect(integrationService.refreshNeeded).not.toHaveBeenCalled();
    expect(integrationService.disconnectChannel).not.toHaveBeenCalled();
  });

  it('persists the refreshed credential', async () => {
    const provider = refreshableProvider();
    const { service, integrationService } = buildService(provider);

    await service.refresh(INTEGRATION);

    expect(integrationService.createOrUpdateIntegration).toHaveBeenCalled();
    const args = integrationService.createOrUpdateIntegration.mock
      .calls[0] as any[];
    // internalId is preserved, so the upsert lands on the existing row.
    expect(args[6]).toBe('17841400000000001');
  });

  it('falls back to reconnection when the exchange yields nothing', async () => {
    const provider = {
      ...refreshableProvider(),
      refreshToken: jest.fn(async () => ({ accessToken: '' } as any)),
    };
    const { service, integrationService } = buildService(provider);

    const result = await service.refresh(INTEGRATION);

    expect(result).toBe(false);
    expect(integrationService.refreshNeeded).toHaveBeenCalled();
  });

  it('treats a thrown exchange as a failed refresh, not a crash', async () => {
    const provider = {
      ...refreshableProvider(),
      refreshToken: jest.fn(async () => {
        throw new Error('upstream exploded');
      }),
    };
    const { service, integrationService } = buildService(provider);

    await expect(service.refresh(INTEGRATION)).resolves.toBe(false);
    expect(integrationService.refreshNeeded).toHaveBeenCalled();
  });
});

describe('default capability', () => {
  it('assumes a provider can refresh unless it says otherwise', async () => {
    // Guards against the flag silently disabling refresh everywhere.
    const provider = { ...refreshableProvider() } as any;
    delete provider.canRefreshToken;
    const { service } = buildService(provider);

    await service.refresh(INTEGRATION);

    expect(provider.refreshToken).toHaveBeenCalled();
  });
});
