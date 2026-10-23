import { MetaActivity } from '@gitroom/orchestrator/activities/meta.activity';

/**
 * Covers the failure path the workflow drives after its retries are exhausted.
 *
 * The workflow itself is not replayed here: that needs @temporalio/testing,
 * which is not installed in this repo. What is asserted is the behaviour the
 * workflow depends on — that a terminal failure is recorded and that an
 * operator is alerted rather than it passing silently.
 */
describe('MetaActivity', () => {
  const makeDeletionService = () => ({
    process: jest.fn(async () => ({ matched: 2, status: 'COMPLETED' })),
    markFailed: jest.fn(async () => undefined),
    reconcile: jest.fn(async () => ({ restarted: [], stalled: [] })),
  });
  const makeAlertService = () => ({
    alert: jest.fn(async () => true),
  });

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('delegates processing and returns the match count', async () => {
    const deletion = makeDeletionService();
    const activity = new MetaActivity(
      deletion as any,
      makeAlertService() as any
    );

    await expect(activity.processMetaDeletion('req-1')).resolves.toEqual({
      matched: 2,
      status: 'COMPLETED',
    });
    expect(deletion.process).toHaveBeenCalledWith('req-1');
  });

  it('surfaces a processing failure so Temporal can retry it', async () => {
    const deletion = makeDeletionService();
    deletion.process = jest.fn(async () => {
      throw new Error('transient database error');
    });
    const activity = new MetaActivity(
      deletion as any,
      makeAlertService() as any
    );

    await expect(activity.processMetaDeletion('req-1')).rejects.toThrow(
      'transient database error'
    );
  });

  it('records a terminal failure against the request', async () => {
    const deletion = makeDeletionService();
    const activity = new MetaActivity(
      deletion as any,
      makeAlertService() as any
    );

    await activity.failMetaDeletion('req-1', 'gave up after 5 attempts');

    expect(deletion.markFailed).toHaveBeenCalledWith(
      'req-1',
      'gave up after 5 attempts'
    );
  });

  it('alerts an operator with an opaque reference and a category', async () => {
    const alerts = makeAlertService();
    const activity = new MetaActivity(makeDeletionService() as any, alerts as any);

    await activity.alertMetaDeletionFailure('req-1', 'retries exhausted');

    expect(alerts.alert).toHaveBeenCalledWith({
      requestId: 'req-1',
      category: 'deletion_failed',
      detail: 'retries exhausted',
    });
  });

  it('fails the activity when the alert cannot be delivered', async () => {
    const alerts = makeAlertService();
    alerts.alert = jest.fn(async () => false);
    const activity = new MetaActivity(makeDeletionService() as any, alerts as any);

    // An undelivered compliance alert must surface in Temporal rather than
    // being swallowed.
    await expect(
      activity.alertMetaDeletionFailure('req-1')
    ).rejects.toThrow('Could not deliver the compliance alert');
  });

  it('raises a separate alert when a verified request matches nothing', async () => {
    const deletion = makeDeletionService();
    deletion.process = jest.fn(async () => ({
      matched: 0,
      status: 'UNMATCHED',
    }));
    const alerts = makeAlertService();
    const activity = new MetaActivity(deletion as any, alerts as any);

    const result = await activity.processMetaDeletion('req-9');

    expect(result).toEqual({ matched: 0, status: 'UNMATCHED' });
    expect(alerts.alert).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-9',
        category: 'identity_unmatched',
      })
    );
  });

  it('does not alert when the deletion matched something', async () => {
    const alerts = makeAlertService();
    const activity = new MetaActivity(makeDeletionService() as any, alerts as any);

    await activity.processMetaDeletion('req-1');

    expect(alerts.alert).not.toHaveBeenCalled();
  });

  describe('reconciliation', () => {
    it('reports how many stranded requests were re-driven', async () => {
      const deletion = makeDeletionService();
      deletion.reconcile = jest.fn(async () => ({
        restarted: ['req-1', 'req-2'],
        stalled: [],
      }));
      const alerts = makeAlertService();
      const activity = new MetaActivity(deletion as any, alerts as any);

      await expect(activity.reconcileMetaDeletions()).resolves.toEqual({
        restarted: 2,
        stalled: 0,
      });
      expect(alerts.alert).not.toHaveBeenCalled();
    });

    it('alerts once per request open beyond the window', async () => {
      const deletion = makeDeletionService();
      deletion.reconcile = jest.fn(async () => ({
        restarted: ['req-1'],
        stalled: ['req-1'],
      }));
      const alerts = makeAlertService();
      const activity = new MetaActivity(deletion as any, alerts as any);

      await activity.reconcileMetaDeletions();

      expect(alerts.alert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'req-1',
          category: 'deletion_stalled',
        })
      );
    });

    it('does nothing when there is nothing outstanding', async () => {
      const alerts = makeAlertService();
      const activity = new MetaActivity(
        makeDeletionService() as any,
        alerts as any
      );

      await expect(activity.reconcileMetaDeletions()).resolves.toEqual({
        restarted: 0,
        stalled: 0,
      });
      expect(alerts.alert).not.toHaveBeenCalled();
    });
  });
});
