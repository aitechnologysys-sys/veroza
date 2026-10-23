jest.mock('@sentry/nestjs', () => ({
  init: jest.fn(),
  consoleLoggingIntegration: jest.fn((opts: any) => ({
    name: 'Console',
    ...opts,
  })),
  openAIIntegration: jest.fn((opts: any) => ({ name: 'OpenAI', ...opts })),
}));
jest.mock('@sentry/profiling-node', () => ({
  nodeProfilingIntegration: jest.fn(() => ({ name: 'Profiling' })),
}));

import * as Sentry from '@sentry/nestjs';
import {
  initializeSentry,
  getSentryDsn,
} from '@gitroom/nestjs-libraries/sentry/initialize.sentry';

const initOptions = () => (Sentry.init as jest.Mock).mock.calls[0][0];
const integration = (name: string) =>
  initOptions().integrations.find((i: any) => i.name === name);

describe('initializeSentry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SENTRY_DSN;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    delete process.env.SENTRY_CONSOLE_LEVELS;
    delete process.env.SENTRY_RECORD_AI_IO;
  });

  describe('DSN resolution', () => {
    it('prefers the server-side SENTRY_DSN', () => {
      process.env.SENTRY_DSN = 'https://server@sentry.invalid/1';
      process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://legacy@sentry.invalid/2';

      expect(getSentryDsn()).toBe('https://server@sentry.invalid/1');
      initializeSentry('backend');
      expect(initOptions().dsn).toBe('https://server@sentry.invalid/1');
    });

    it('still honours the existing NEXT_PUBLIC_SENTRY_DSN', () => {
      process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://legacy@sentry.invalid/2';

      expect(getSentryDsn()).toBe('https://legacy@sentry.invalid/2');
      expect(initializeSentry('backend')).toBe(true);
    });

    it('does not initialize when neither is set', () => {
      expect(initializeSentry('backend')).toBeNull();
      expect(Sentry.init).not.toHaveBeenCalled();
    });
  });

  describe('console capture', () => {
    beforeEach(() => {
      process.env.SENTRY_DSN = 'https://server@sentry.invalid/1';
    });

    it('forwards only warn and error by default', () => {
      initializeSentry('backend');

      expect(integration('Console').levels).toEqual(['warn', 'error']);
    });

    it('does not forward routine console output', () => {
      initializeSentry('backend');
      const levels = integration('Console').levels;

      // Provider code logs whole credential objects at `log` level
      // (listmonk.provider.ts:82, threads.provider.ts:43). Forwarding those
      // would transmit a plaintext password to Sentry.
      for (const noisy of ['log', 'info', 'debug', 'trace', 'assert']) {
        expect(levels).not.toContain(noisy);
      }
    });

    it('allows an operator to widen the levels deliberately', () => {
      process.env.SENTRY_CONSOLE_LEVELS = 'warn, error, info';
      initializeSentry('backend');

      expect(integration('Console').levels).toEqual(['warn', 'error', 'info']);
    });
  });

  describe('AI input/output capture', () => {
    beforeEach(() => {
      process.env.SENTRY_DSN = 'https://server@sentry.invalid/1';
    });

    it('is off unless explicitly enabled', () => {
      initializeSentry('backend');

      expect(integration('OpenAI')).toMatchObject({
        recordInputs: false,
        recordOutputs: false,
      });
    });

    it('can be turned on', () => {
      process.env.SENTRY_RECORD_AI_IO = 'true';
      initializeSentry('backend');

      expect(integration('OpenAI')).toMatchObject({
        recordInputs: true,
        recordOutputs: true,
      });
    });
  });

  describe('beforeSend scrubbing', () => {
    beforeEach(() => {
      process.env.SENTRY_DSN = 'https://server@sentry.invalid/1';
      initializeSentry('backend');
    });

    it('redacts credentials anywhere in the payload', () => {
      const event: any = {
        extra: {
          body: {
            url: 'https://listmonk.example',
            username: 'admin',
            password: 'hunter2',
          },
          nested: { access_token: 'abc', api_key: 'def', safe: 'keep me' },
        },
      };

      const sent = initOptions().beforeSend(event);

      expect(sent.extra.body.password).toBe('[redacted]');
      expect(sent.extra.nested.access_token).toBe('[redacted]');
      expect(sent.extra.nested.api_key).toBe('[redacted]');
      // Non-sensitive values survive, or the report would be useless.
      expect(sent.extra.body.username).toBe('admin');
      expect(sent.extra.nested.safe).toBe('keep me');
    });

    it('redacts signed requests and client secrets', () => {
      const event: any = {
        request: {
          data: {
            signed_request: 'sig.payload',
            client_secret: 'shh',
            code_verifier: 'pkce',
          },
        },
      };

      const sent = initOptions().beforeSend(event);

      expect(sent.request.data.signed_request).toBe('[redacted]');
      expect(sent.request.data.client_secret).toBe('[redacted]');
      expect(sent.request.data.code_verifier).toBe('[redacted]');
    });

    it('leaves the compliance alert context intact', () => {
      const event: any = {
        contexts: {
          meta_deletion_request: {
            requestId: 'req-1',
            category: 'deletion_failed',
            environment: 'production',
          },
        },
      };

      const sent = initOptions().beforeSend(event);

      expect(sent.contexts.meta_deletion_request).toEqual({
        requestId: 'req-1',
        category: 'deletion_failed',
        environment: 'production',
      });
    });

    it('redacts secrets carried in URL query strings', () => {
      const event: any = {
        request: {
          url: 'https://app.postaryx.com/integrations/social/reddit?code=OAUTH_CODE&state=abc',
        },
        extra: {
          note: 'failed calling https://graph.facebook.com/me?access_token=SECRET_VALUE&fields=id',
        },
      };

      const sent = initOptions().beforeSend(event);

      expect(sent.request.url).not.toContain('OAUTH_CODE');
      expect(sent.request.url).toContain('code=[redacted]');
      // Non-sensitive params are preserved so the report stays useful.
      expect(sent.request.url).toContain('state=abc');
      expect(sent.extra.note).not.toContain('SECRET_VALUE');
      expect(sent.extra.note).toContain('fields=id');
    });

    it('redacts secrets inside serialized exceptions', () => {
      const event: any = {
        exception: {
          values: [
            {
              type: 'Error',
              value:
                'Request failed: POST https://api.example.com/token?client_secret=SHHH',
              stacktrace: {
                frames: [
                  { filename: 'x.ts', vars: { password: 'hunter2' } },
                ],
              },
            },
          ],
        },
      };

      const sent = initOptions().beforeSend(event);

      expect(JSON.stringify(sent)).not.toContain('SHHH');
      expect(JSON.stringify(sent)).not.toContain('hunter2');
      // The useful part of the message survives.
      expect(sent.exception.values[0].value).toContain('Request failed');
    });

    it('redacts the top-level message and breadcrumbs', () => {
      const event: any = {
        message: 'callback rejected: signed_request=FORGED_PAYLOAD',
        breadcrumbs: [
          { message: 'GET /cb?access_token=LEAKY', data: { token: 'abc' } },
        ],
      };

      const sent = initOptions().beforeSend(event);

      expect(sent.message).not.toContain('FORGED_PAYLOAD');
      expect(JSON.stringify(sent.breadcrumbs)).not.toContain('LEAKY');
      expect(JSON.stringify(sent.breadcrumbs)).not.toContain('abc');
    });

    it('handles arrays and deep nesting without throwing', () => {
      const event: any = {
        extra: { list: [{ token: 'a' }, { ok: 1 }], deep: { a: { b: { c: { password: 'x' } } } } },
      };

      const sent = initOptions().beforeSend(event);

      expect(sent.extra.list[0].token).toBe('[redacted]');
      expect(sent.extra.list[1].ok).toBe(1);
      expect(sent.extra.deep.a.b.c.password).toBe('[redacted]');
    });
  });
});
