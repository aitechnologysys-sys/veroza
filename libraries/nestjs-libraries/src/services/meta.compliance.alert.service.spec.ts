// @sentry/nestjs exports are non-configurable, so jest.spyOn cannot replace
// them. Mock the module instead.
jest.mock('@sentry/nestjs', () => ({
  withScope: jest.fn(),
  captureMessage: jest.fn(),
  // Present means initializeSentry() ran with a DSN.
  getClient: jest.fn(() => ({})),
}));

import * as Sentry from '@sentry/nestjs';
import { MetaComplianceAlertService } from '@gitroom/nestjs-libraries/services/meta.compliance.alert.service';

describe('MetaComplianceAlertService', () => {
  let service: MetaComplianceAlertService;
  let captured: { message: string; scope: any } | null;

  const makeScope = () => ({
    level: undefined as any,
    tags: {} as any,
    contexts: {} as any,
    fingerprint: [] as string[],
    setLevel(l: any) {
      this.level = l;
    },
    setTags(t: any) {
      Object.assign(this.tags, t);
    },
    setContext(k: string, v: any) {
      this.contexts[k] = v;
    },
    setFingerprint(f: string[]) {
      this.fingerprint = f;
    },
  });

  beforeEach(() => {
    captured = null;
    const scope = makeScope();

    (Sentry.withScope as jest.Mock).mockImplementation((cb: any) => cb(scope));
    (Sentry.captureMessage as jest.Mock).mockImplementation(
      (message: string) => {
        captured = { message, scope };
        return 'event-id';
      }
    );
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    service = new MetaComplianceAlertService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('reports a permanent failure as an error with the request reference', async () => {
    await expect(
      service.alert({ requestId: 'req-1', category: 'deletion_failed' })
    ).resolves.toBe(true);

    expect(captured!.message).toContain('deletion_failed');
    expect(captured!.message).toContain('req-1');
    expect(captured!.scope.level).toBe('error');
    expect(captured!.scope.tags.feature).toBe('meta-data-deletion');
    expect(captured!.scope.contexts.meta_deletion_request).toEqual(
      expect.objectContaining({
        requestId: 'req-1',
        category: 'deletion_failed',
        environment: expect.any(String),
        timestamp: expect.any(String),
      })
    );
  });

  it('reports an unmapped identity at a lower severity', async () => {
    await service.alert({
      requestId: 'req-2',
      category: 'identity_unmatched',
    });

    expect(captured!.scope.level).toBe('warning');
  });

  // Alert storms
  it('fingerprints by category and request so repeats collapse', async () => {
    await service.alert({ requestId: 'req-1', category: 'deletion_failed' });
    const first = [...captured!.scope.fingerprint];

    await service.alert({ requestId: 'req-1', category: 'deletion_failed' });
    expect(captured!.scope.fingerprint).toEqual(first);

    // A different request must still raise its own issue.
    await service.alert({ requestId: 'req-2', category: 'deletion_failed' });
    expect(captured!.scope.fingerprint).not.toEqual(first);

    // As must a different category for the same request (escalation).
    await service.alert({ requestId: 'req-1', category: 'deletion_stalled' });
    expect(captured!.scope.fingerprint).not.toEqual(first);
  });

  // No sensitive data
  it('carries no personal identifiers, tokens or signed payloads', async () => {
    await service.alert({
      requestId: 'req-1',
      category: 'deletion_failed',
      detail: 'retries exhausted',
    });

    const serialized = JSON.stringify({
      message: captured!.message,
      tags: captured!.scope.tags,
      contexts: captured!.scope.contexts,
    });

    for (const forbidden of [
      'signed_request',
      'access_token',
      'FACEBOOK_APP_SECRET',
      'metaUserId',
      'organizationId',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('writes a structured log line alongside the alert', async () => {
    await service.alert({ requestId: 'req-1', category: 'deletion_failed' });

    const line = (console.error as jest.Mock).mock.calls[0][0];
    expect(JSON.parse(line)).toEqual(
      expect.objectContaining({
        event: 'meta_deletion_alert',
        category: 'deletion_failed',
        requestId: 'req-1',
      })
    );
  });

  // Delivery failure must itself be observable
  it('returns false and logs when the alert channel throws', async () => {
    (Sentry.withScope as jest.Mock).mockImplementation(() => {
      throw new Error('sentry unreachable');
    });

    await expect(
      service.alert({ requestId: 'req-3', category: 'deletion_failed' })
    ).resolves.toBe(false);

    const line = (console.error as jest.Mock).mock.calls.at(-1)![0];
    expect(JSON.parse(line)).toEqual(
      expect.objectContaining({
        event: 'meta_deletion_alert_delivery_failed',
        requestId: 'req-3',
      })
    );
  });

  it('treats an uninitialized Sentry as undelivered rather than silently dropping', async () => {
    // No DSN configured: captureMessage would be a no-op, so reporting success
    // would hide the alert entirely.
    (Sentry.getClient as jest.Mock).mockReturnValueOnce(undefined);

    await expect(
      service.alert({ requestId: 'req-5', category: 'deletion_failed' })
    ).resolves.toBe(false);

    const line = (console.error as jest.Mock).mock.calls.at(-1)![0];
    expect(JSON.parse(line).event).toBe('meta_deletion_alert_delivery_failed');
  });

  it('never throws, so a failed alert cannot undo a completed deletion', async () => {
    (Sentry.withScope as jest.Mock).mockImplementation(() => {
      throw new Error('boom');
    });

    await expect(
      service.alert({ requestId: 'req-4', category: 'deletion_failed' })
    ).resolves.toBe(false);
  });
});
