import { createHmac } from 'crypto';
import { MetaController } from '@gitroom/backend/api/routes/meta.controller';
import { MetaSignedRequestService } from '@gitroom/nestjs-libraries/services/meta.signed.request.service';

const FACEBOOK_SECRET = 'facebook-app-secret';
const THREADS_SECRET = 'threads-app-secret';

const b64url = (v: Buffer | string) => Buffer.from(v as any).toString('base64url');

const sign = (payload: object, secret: string) => {
  const encoded = b64url(JSON.stringify(payload));
  return `${b64url(
    createHmac('sha256', secret).update(encoded).digest()
  )}.${encoded}`;
};

const validSigned = (userId: string, secret = FACEBOOK_SECRET) =>
  sign({ algorithm: 'HMAC-SHA256', user_id: userId }, secret);

const makeDeletionService = () => ({
  accept: jest.fn(async () => ({
    request: { id: 'req-1', confirmationCode: 'CODE-1' },
    isNew: true,
  })),
  enqueue: jest.fn(async () => undefined),
  // Widened so individual tests can override it with another status without
  // TypeScript narrowing the mock to this one literal shape.
  publicStatus: jest.fn(
    async (
      code: string
    ): Promise<{
      confirmationCode: string;
      status: string;
      receivedAt: string | null;
      completedAt: string | null;
    }> => ({
      confirmationCode: code,
      status: 'completed',
      receivedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-02T00:00:00.000Z',
    })
  ),
  markFailed: jest.fn(),
});

describe('MetaController', () => {
  let controller: MetaController;
  let deletion: ReturnType<typeof makeDeletionService>;

  beforeEach(() => {
    process.env.FACEBOOK_APP_SECRET = FACEBOOK_SECRET;
    process.env.THREADS_APP_SECRET = THREADS_SECRET;
    process.env.FRONTEND_URL = 'https://app.postaryx.com';
    // nginx puts the backend behind /api in production; the status page is a
    // backend route, so the URL Meta gets must carry that prefix.
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://app.postaryx.com/api';
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    deletion = makeDeletionService();
    controller = new MetaController(
      new MetaSignedRequestService(),
      deletion as any
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('data deletion callback', () => {
    // 1. Valid signature
    it('accepts a valid request and returns Meta the required fields', async () => {
      const result: any = await controller.dataDeletion('facebook', {
        signed_request: validSigned('fb-1'),
      });

      expect(deletion.accept).toHaveBeenCalledWith(
        'FACEBOOK',
        'fb-1',
        'DATA_DELETION'
      );
      expect(deletion.enqueue).toHaveBeenCalledWith('req-1');
      expect(result).toEqual({
        url: 'https://app.postaryx.com/api/meta/data-deletion/status/CODE-1',
        confirmation_code: 'CODE-1',
      });
    });

    // 2. Invalid signature
    it('rejects a bad signature and does not queue anything', async () => {
      const result: any = await controller.dataDeletion('facebook', {
        signed_request: `${b64url('bad')}.${b64url('{}')}`,
      });

      expect(result).toEqual({ error: 'invalid_request' });
      expect(deletion.accept).not.toHaveBeenCalled();
      expect(deletion.enqueue).not.toHaveBeenCalled();
    });

    it('rejects a missing signed_request', async () => {
      const result: any = await controller.dataDeletion('facebook', {});

      expect(result).toEqual({ error: 'invalid_request' });
      expect(deletion.accept).not.toHaveBeenCalled();
    });

    // 3. Incorrect app secret / cross-app replay
    it('rejects a request signed by a different Meta app', async () => {
      const result: any = await controller.dataDeletion('facebook', {
        signed_request: validSigned('th-1', THREADS_SECRET),
      });

      expect(result).toEqual({ error: 'invalid_request' });
      expect(deletion.accept).not.toHaveBeenCalled();
    });

    it('rejects an unknown app slug', async () => {
      const result: any = await controller.dataDeletion('linkedin', {
        signed_request: validSigned('fb-1'),
      });

      expect(result).toEqual({ error: 'invalid_request' });
      expect(deletion.accept).not.toHaveBeenCalled();
    });

    // 6. Duplicate callbacks
    it('does not re-queue a replayed callback', async () => {
      deletion.accept = jest.fn(async () => ({
        request: { id: 'req-1', confirmationCode: 'CODE-1' },
        isNew: false,
      }));

      const result: any = await controller.dataDeletion('facebook', {
        signed_request: validSigned('fb-1'),
      });

      expect(deletion.enqueue).not.toHaveBeenCalled();
      // Meta still gets a usable answer for the existing request.
      expect(result.confirmation_code).toBe('CODE-1');
    });

    it('builds the status URL against the backend, not the frontend', async () => {
      process.env.NEXT_PUBLIC_BACKEND_URL = 'https://app.postaryx.com/api/';
      const result: any = await controller.dataDeletion('facebook', {
        signed_request: validSigned('fb-1'),
      });

      // Trailing slash normalised, and never the bare frontend origin.
      expect(result.url).toBe(
        'https://app.postaryx.com/api/meta/data-deletion/status/CODE-1'
      );
    });
  });


  describe('deauthorize callback', () => {
    it('queues deletion for a verified request', async () => {
      await controller.deauthorize('facebook', {
        signed_request: validSigned('fb-9'),
      });

      expect(deletion.accept).toHaveBeenCalledWith(
        'FACEBOOK',
        'fb-9',
        'DEAUTHORIZE'
      );
      expect(deletion.enqueue).toHaveBeenCalledWith('req-1');
    });

    it('answers 200 for an invalid request without acting on it', async () => {
      const result = await controller.deauthorize('facebook', {
        signed_request: 'garbage',
      });

      // Meta ignores the body; a differing status would tell a prober whether
      // a signature was accepted.
      expect(result).toEqual({ success: true });
      expect(deletion.accept).not.toHaveBeenCalled();
    });

    it('answers 200 for an unknown app slug', async () => {
      await expect(
        controller.deauthorize('nope', { signed_request: validSigned('x') })
      ).resolves.toEqual({ success: true });
      expect(deletion.accept).not.toHaveBeenCalled();
    });
  });

  // 10. Public deletion-status response
  describe('status page', () => {
    it('renders the status without leaking account data', async () => {
      const html = await controller.status('CODE-1');

      expect(html).toContain('Your data has been deleted.');
      expect(html).toContain('CODE-1');
      expect(html).toContain('noindex');
      // Nothing identifying should ever reach this page.
      expect(html).not.toMatch(/fb-\d|user_id|organization/i);
    });

    it('does not confirm whether an unknown code ever existed', async () => {
      deletion.publicStatus = jest.fn(async (code: string) => ({
        confirmationCode: code,
        status: 'not_found' as const,
        receivedAt: null,
        completedAt: null,
      }));

      const html = await controller.status('whatever');

      expect(html).toContain('We have no record of this deletion request.');
    });

    it('escapes the code so it cannot inject markup', async () => {
      const html = await controller.status('<script>alert(1)</script>');

      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;script&gt;');
    });
  });
});
