/**
 * Regression tests for credential-safe revocation failure logging.
 *
 * Both call sites used to log the caught error object itself. HTTP clients
 * attach the request URL, headers and upstream body to their errors, and
 * `cause` nests another error doing the same — and the Facebook revocation URL
 * carries the access token in its query string. These tests pin the guarantee
 * that none of that reaches a log line, including through nesting.
 */
process.env.STORAGE_PROVIDER = process.env.STORAGE_PROVIDER || 'local';
process.env.UPLOAD_DIRECTORY = process.env.UPLOAD_DIRECTORY || '/tmp';

import { logRevocationFailure } from '@gitroom/nestjs-libraries/helpers/revocation.log';

const TOKEN = 'SYNTHETIC-not-a-real-token-0123456789abcdef';
const REFRESH = 'SYNTHETIC-not-a-real-refresh-9876543210';

/** An error shaped like what a real HTTP client throws, secrets and all. */
const hostileError = () => {
  const inner: any = new Error(
    `Request failed: https://graph.facebook.com/v20.0/me/permissions?access_token=${TOKEN}`
  );
  inner.config = {
    url: `https://graph.facebook.com/v20.0/me/permissions?access_token=${TOKEN}`,
    headers: { Authorization: `Bearer ${TOKEN}`, Cookie: `session=${REFRESH}` },
  };
  inner.response = {
    status: 401,
    data: { error: 'invalid', access_token: TOKEN, refresh_token: REFRESH },
  };

  const outer: any = new Error(`Revocation blew up for token ${TOKEN}`);
  outer.cause = inner;
  outer.status = 401;
  return outer;
};

describe('logRevocationFailure', () => {
  let spy: jest.SpyInstance;
  const written = () => spy.mock.calls.map((c) => c.join(' ')).join('\n');

  beforeEach(() => {
    spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => spy.mockRestore());

  it('writes exactly one structured line', () => {
    logRevocationFailure({ id: 'int-1', providerIdentifier: 'facebook' }, hostileError());
    expect(spy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(spy.mock.calls[0][0]);
    expect(payload).toEqual({
      event: 'upstream_revocation_failed',
      integrationId: 'int-1',
      provider: 'facebook',
      category: 'upstream_rejected',
      status: 401,
      errorType: 'Error',
    });
  });

  it('leaks no token, refresh token, URL, header or body — including from the nested cause', () => {
    logRevocationFailure({ id: 'int-1', providerIdentifier: 'facebook' }, hostileError());
    const out = written();
    for (const secret of [TOKEN, REFRESH, 'Authorization', 'Bearer', 'Cookie',
                          'access_token', 'refresh_token', 'graph.facebook.com', 'https://']) {
      expect(out).not.toContain(secret);
    }
  });

  it('never carries message, stack, cause, config, request or response', () => {
    logRevocationFailure({ id: 'int-1' }, hostileError());
    const payload = JSON.parse(spy.mock.calls[0][0]);
    for (const banned of ['message', 'stack', 'cause', 'config', 'request', 'response']) {
      expect(payload).not.toHaveProperty(banned);
    }
  });

  it('survives a cause chain without walking it into the output', () => {
    const deep: any = new Error('level-3');
    deep.config = { headers: { Authorization: `Bearer ${TOKEN}` } };
    const mid: any = new Error(`level-2 ${TOKEN}`);
    mid.cause = deep;
    const top: any = new Error(`level-1 ${TOKEN}`);
    top.cause = mid;

    logRevocationFailure({ id: 'int-deep' }, top);
    expect(written()).not.toContain(TOKEN);
    expect(JSON.parse(spy.mock.calls[0][0]).category).toBe('unknown');
  });

  describe('failure categories come from structured fields, not message text', () => {
    it('classifies an HTTP status as upstream_rejected', () => {
      const err: any = new Error('nope');
      err.status = 403;
      logRevocationFailure({ id: 'i' }, err);
      const p = JSON.parse(spy.mock.calls[0][0]);
      expect(p.category).toBe('upstream_rejected');
      expect(p.status).toBe(403);
    });

    it('classifies an allowlisted transport code as network', () => {
      const err: any = new TypeError('fetch failed');
      err.code = 'ECONNREFUSED';
      logRevocationFailure({ id: 'i' }, err);
      const p = JSON.parse(spy.mock.calls[0][0]);
      expect(p.category).toBe('network');
      expect(p.code).toBe('ECONNREFUSED');
      expect(p.errorType).toBe('TypeError');
    });

    it('falls back to unknown rather than guessing from the message', () => {
      // The message says "status 500", but nothing structured confirms it.
      logRevocationFailure({ id: 'i' }, new Error('failed with status 500'));
      const p = JSON.parse(spy.mock.calls[0][0]);
      expect(p.category).toBe('unknown');
      expect(p).not.toHaveProperty('status');
    });
  });

  describe('every emitted value is allowlisted and bounded', () => {
    it('drops an error.code that is not a known transport code', () => {
      const err: any = new Error('x');
      // A library can put anything in `code`, including a response body.
      err.code = `LEAKED ${TOKEN}`;
      logRevocationFailure({ id: 'i' }, err);
      const p = JSON.parse(spy.mock.calls[0][0]);
      expect(p).not.toHaveProperty('code');
      expect(p.category).toBe('unknown');
      expect(written()).not.toContain(TOKEN);
    });

    it('replaces a non-standard error.name rather than echoing it', () => {
      const err: any = new Error('x');
      err.name = `CustomError-${TOKEN}`;
      logRevocationFailure({ id: 'i' }, err);
      expect(JSON.parse(spy.mock.calls[0][0]).errorType).toBe('Other');
      expect(written()).not.toContain(TOKEN);
    });

    it.each([99, 600, 1.5, NaN, -1])('drops an out-of-range status: %s', (bad) => {
      const err: any = new Error('x');
      err.status = bad;
      logRevocationFailure({ id: 'i' }, err);
      const p = JSON.parse(spy.mock.calls[0][0]);
      expect(p).not.toHaveProperty('status');
      expect(p.category).toBe('unknown');
    });

    it('does not read status out of a nested response object', () => {
      const err: any = new Error('x');
      err.response = { status: 401, data: { access_token: TOKEN } };
      logRevocationFailure({ id: 'i' }, err);
      expect(written()).not.toContain(TOKEN);
      expect(JSON.parse(spy.mock.calls[0][0]).category).toBe('unknown');
    });

    it('refuses an identifier that is not id-shaped', () => {
      logRevocationFailure({ id: `../../etc/passwd ${TOKEN}` } as any, new Error('x'));
      const p = JSON.parse(spy.mock.calls[0][0]);
      expect(p.integrationId).toBe('(unloggable)');
      expect(written()).not.toContain(TOKEN);
    });

    it('refuses a provider identifier that is not provider-shaped', () => {
      logRevocationFailure(
        { id: 'int-1', providerIdentifier: `facebook ${TOKEN}` },
        new Error('x')
      );
      const p = JSON.parse(spy.mock.calls[0][0]);
      expect(p).not.toHaveProperty('provider');
      expect(written()).not.toContain(TOKEN);
    });

    it('emits only the known key set, whatever the error carries', () => {
      const err: any = hostileError();
      err.code = 'ECONNREFUSED';
      logRevocationFailure({ id: 'int-1', providerIdentifier: 'facebook' }, err);
      expect(Object.keys(JSON.parse(spy.mock.calls[0][0])).sort()).toEqual(
        ['category', 'code', 'errorType', 'event', 'integrationId', 'provider', 'status'].sort()
      );
    });
  });

  it('handles a non-Error throwable', () => {
    logRevocationFailure({ id: 'i' }, `boom ${TOKEN}`);
    expect(written()).not.toContain(TOKEN);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('best-effort contract is preserved at both call sites', () => {
  let spy: jest.SpyInstance;
  beforeEach(() => {
    spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => spy.mockRestore());

  const integration: any = {
    id: 'int-9',
    providerIdentifier: 'facebook',
    token: 'stored-token',
  };

  const managerThatFails = () => ({
    getSocialIntegration: () => ({
      revokeToken: jest.fn(async () => {
        throw hostileError();
      }),
    }),
  });

  it('DeletionService.revokeUpstream returns false instead of throwing', async () => {
    const {
      DeletionService,
    } = require('@gitroom/nestjs-libraries/database/prisma/deletion/deletion.service');
    const service = new DeletionService({} as any, managerThatFails() as any, {} as any);

    await expect(service.revokeUpstream(integration)).resolves.toBe(false);
    expect(spy.mock.calls.join(' ')).not.toContain(TOKEN);
  });

  it('IntegrationService revocation failure does not propagate', async () => {
    const {
      IntegrationService,
    } = require('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service');
    const service = new IntegrationService(
      {} as any, {} as any, managerThatFails() as any,
      {} as any, {} as any, {} as any
    );

    await expect(
      (service as any).revokeUpstreamAuthorization(integration)
    ).resolves.toBeUndefined();
    expect(spy.mock.calls.join(' ')).not.toContain(TOKEN);
  });
});
