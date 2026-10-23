/**
 * Drives postWorkflowV105 with its activities mocked.
 *
 * @temporalio/testing is not installed in this repo, so this is not a replay
 * against a recorded history. `@temporalio/workflow` is replaced with plain
 * functions and the workflow body runs as ordinary async code. What it pins:
 * a provider result carrying a `warning` (a YouTube video published without
 * its thumbnail) is stored as published with its release ID and URL, gets the
 * warning notification, and schedules exactly the same activities in the same
 * order as a plain success — which is what keeps in-flight workflows
 * replayable.
 *
 * It also pins that once postSocial/postComment has returned, a failure
 * recording the result (updatePost, the notification) never publishes again.
 * `patched()` is mocked: true is a new execution, false is the replay of a
 * history recorded before the patch, which must keep the old path.
 */
import {
  ActivityFailure,
  ApplicationFailure,
  RetryState,
} from '@temporalio/common';

const mockActivities: Record<string, jest.Mock> = {};
const mockPatched = jest.fn((_id: string) => true);
const mockSleep = jest.fn(async (_ms: unknown) => undefined);

jest.mock('@temporalio/workflow', () => {
  const common = jest.requireActual('@temporalio/common');
  return {
    ActivityFailure: common.ActivityFailure,
    ApplicationFailure: common.ApplicationFailure,
    proxyActivities: () =>
      new Proxy(
        {},
        {
          get: (_target, name: string) => (mockActivities[name] ??= jest.fn()),
        }
      ),
    sleep: (ms: unknown) => mockSleep(ms),
    patched: (id: string) => mockPatched(id),
    defineSignal: jest.fn(() => 'poke'),
    setHandler: jest.fn(),
    startChild: jest.fn(),
  };
});

import { postWorkflowV105 } from './post.workflow.v1.0.5';

const VIDEO_ID = 'MWqtPykvbcY';
const VIDEO_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;

const integration = {
  id: 'int-1',
  organizationId: 'org-1',
  providerIdentifier: 'youtube',
  name: 'My Channel',
  refreshNeeded: false,
  disabled: false,
};

const run = () =>
  postWorkflowV105({
    taskQueue: 'youtube',
    postId: 'post-1',
    organizationId: 'org-1',
    postNow: true,
  });

/** Activity names in the order the workflow scheduled them. */
const scheduled = () =>
  Object.entries(mockActivities)
    .flatMap(([name, fn]) =>
      fn.mock.invocationCallOrder.map((order) => ({ name, order }))
    )
    .sort((a, b) => a.order - b.order)
    .map(({ name }) => name);

const act = (name: string) => (mockActivities[name] ??= jest.fn());

describe('postWorkflowV105 publishing result', () => {
  beforeEach(() => {
    Object.values(mockActivities).forEach((fn) => fn.mockReset());
    mockPatched.mockReset().mockReturnValue(true);
    mockSleep.mockReset().mockResolvedValue(undefined);
    act('getPost').mockResolvedValue({ id: 'post-1', state: 'QUEUE' });
    act('getPostsList').mockResolvedValue([
      {
        id: 'post-1',
        organizationId: 'org-1',
        integration,
        settings: '{}',
        intervalInDays: null,
      },
    ]);
    for (const name of [
      'updatePost',
      'inAppNotification',
      'changeState',
      'sendWebhooks',
    ]) {
      act(name).mockResolvedValue(undefined);
    }
    act('internalPlugs').mockResolvedValue([]);
    act('globalPlugs').mockResolvedValue([]);
  });

  const success = {
    id: 'post-1',
    postId: VIDEO_ID,
    releaseURL: VIDEO_URL,
    status: 'success',
  };
  const warning = {
    subject: 'Video published on YouTube, but thumbnail not applied',
    message: `Your video was successfully published to YouTube at ${VIDEO_URL}, but we couldn't apply your custom thumbnail. ...`,
  };

  it('publishes normally and sends the success notification', async () => {
    act('postSocial').mockResolvedValue([success]);

    await run();

    expect(act('updatePost')).toHaveBeenCalledWith(
      'post-1',
      VIDEO_ID,
      VIDEO_URL
    );
    expect(act('changeState')).not.toHaveBeenCalled();
    expect(act('inAppNotification')).toHaveBeenCalledWith(
      'org-1',
      'Your post has been published on Youtube',
      `Your post has been published on Youtube at ${VIDEO_URL}`,
      true,
      true,
      'success'
    );
  });

  it('stores a video published without its thumbnail as published, with a warning', async () => {
    act('postSocial').mockResolvedValue([{ ...success, warning }]);

    await run();

    // PUBLISHED, release ID and URL are written by updatePost.
    expect(act('updatePost')).toHaveBeenCalledWith(
      'post-1',
      VIDEO_ID,
      VIDEO_URL
    );
    expect(act('changeState')).not.toHaveBeenCalled();
    expect(act('inAppNotification')).toHaveBeenCalledTimes(1);
    expect(act('inAppNotification')).toHaveBeenCalledWith(
      'org-1',
      warning.subject,
      warning.message,
      true,
      true,
      'info'
    );
    // The video is never uploaded a second time.
    expect(act('postSocial')).toHaveBeenCalledTimes(1);
    expect(act('sendWebhooks')).toHaveBeenCalledWith(
      VIDEO_ID,
      'org-1',
      'int-1'
    );
  });

  it('schedules the same activities in the same order with or without a warning', async () => {
    act('postSocial').mockResolvedValue([success]);
    await run();
    const plain = scheduled();

    Object.values(mockActivities).forEach((fn) => fn.mockClear());
    act('postSocial').mockResolvedValue([{ ...success, warning }]);
    await run();

    expect(scheduled()).toEqual(plain);
  });

  it('keeps the pending-verification notification unchanged', async () => {
    act('postSocial').mockResolvedValue([
      { ...success, status: 'pending_verification' },
    ]);

    await run();

    expect(act('inAppNotification')).toHaveBeenCalledWith(
      'org-1',
      'Your post on Youtube is waiting for verification',
      `Youtube created your post at ${VIDEO_URL} but keeps it hidden from feeds until its verification challenge is solved. Youtube only sends that challenge to the posting app, so the post will stay hidden for now.`,
      true,
      true,
      'info'
    );
  });

  it('still marks a genuinely failed post ERROR and reports it', async () => {
    act('postSocial').mockRejectedValue(
      new ActivityFailure(
        'Activity task failed',
        'postSocial',
        '3',
        RetryState.NON_RETRYABLE_FAILURE,
        undefined,
        ApplicationFailure.create({
          message: 'The selected video category is invalid.',
          type: 'bad_body',
          nonRetryable: true,
        })
      )
    );

    await run();

    expect(act('updatePost')).not.toHaveBeenCalled();
    expect(act('changeState')).toHaveBeenCalledWith(
      'post-1',
      'ERROR',
      expect.any(ActivityFailure),
      expect.any(Array)
    );
    expect(act('inAppNotification')).toHaveBeenCalledWith(
      'org-1',
      'Error posting on youtube for My Channel',
      'An error occurred while posting on youtube: The selected video category is invalid.',
      true,
      false,
      'fail'
    );
    expect(act('postSocial')).toHaveBeenCalledTimes(1);
  });

  describe('when recording a live post fails', () => {
    // What a workflow sees once an activity has used up its 3 attempts.
    const exhausted = (activityType: string) =>
      new ActivityFailure(
        'Activity task failed',
        activityType,
        '4',
        RetryState.MAXIMUM_ATTEMPTS_REACHED,
        undefined,
        ApplicationFailure.create({ message: 'database unavailable' })
      );

    beforeEach(() => {
      act('postSocial').mockResolvedValue([success]);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('retries updatePost, never publishes again, and does not mark ERROR', async () => {
      act('updatePost')
        .mockRejectedValueOnce(exhausted('updatePost'))
        .mockRejectedValueOnce(exhausted('updatePost'))
        .mockResolvedValue(undefined);

      await run();

      expect(act('postSocial')).toHaveBeenCalledTimes(1);
      expect(act('updatePost')).toHaveBeenCalledTimes(3);
      expect(act('updatePost')).toHaveBeenLastCalledWith(
        'post-1',
        VIDEO_ID,
        VIDEO_URL
      );
      expect(mockSleep).toHaveBeenCalledWith('10 minutes');
      expect(act('changeState')).not.toHaveBeenCalled();
      expect(act('inAppNotification')).toHaveBeenCalledTimes(1);
      expect(act('sendWebhooks')).toHaveBeenCalledTimes(1);
    });

    it('stays open past the sweeper window, then gives up without publishing again', async () => {
      let now = Date.UTC(2026, 9, 23, 15, 26, 51);
      jest.spyOn(Date, 'now').mockImplementation(() => now);
      mockSleep.mockImplementation(async () => {
        now += 10 * 60 * 1000;
      });
      act('updatePost').mockRejectedValue(exhausted('updatePost'));

      await run();

      // First attempt at t=0, then one every 10 minutes until t >= 3 days.
      expect(act('updatePost')).toHaveBeenCalledTimes(3 * 24 * 6 + 1);
      expect(act('postSocial')).toHaveBeenCalledTimes(1);
      expect(act('changeState')).not.toHaveBeenCalled();
      expect(act('inAppNotification')).not.toHaveBeenCalled();
    });

    it('ignores a failed notification instead of publishing again', async () => {
      act('inAppNotification').mockRejectedValue(
        exhausted('inAppNotification')
      );

      await run();

      expect(act('postSocial')).toHaveBeenCalledTimes(1);
      expect(act('updatePost')).toHaveBeenCalledTimes(1);
      expect(act('changeState')).not.toHaveBeenCalled();
      expect(act('sendWebhooks')).toHaveBeenCalledWith(
        VIDEO_ID,
        'org-1',
        'int-1'
      );
    });

    it('never posts a comment twice either', async () => {
      act('getPostsList').mockResolvedValue([
        { id: 'post-1', organizationId: 'org-1', integration, settings: '{}' },
        { id: 'post-2', organizationId: 'org-1', integration, settings: '{}' },
      ]);
      act('isCommentable').mockResolvedValue(true);
      act('postComment').mockResolvedValue([
        {
          id: 'post-2',
          postId: 'comment-1',
          releaseURL: 'c-url',
          status: 'success',
        },
      ]);
      act('updatePost')
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(exhausted('updatePost'))
        .mockResolvedValue(undefined);

      await run();

      expect(act('postComment')).toHaveBeenCalledTimes(1);
      expect(act('updatePost')).toHaveBeenLastCalledWith(
        'post-2',
        'comment-1',
        'c-url'
      );
      expect(act('changeState')).not.toHaveBeenCalled();
    });

    it('keeps the pre-patch path when replaying an older history', async () => {
      // Recorded before the patch: updatePost failed inside the retry loop,
      // the post was marked ERROR and published again. Replay must schedule
      // exactly that, or Temporal raises a nondeterminism error.
      mockPatched.mockReturnValue(false);
      act('updatePost')
        .mockRejectedValueOnce(exhausted('updatePost'))
        .mockResolvedValue(undefined);

      await run();

      expect(scheduled().filter((n) => !n.startsWith('get'))).toEqual([
        'postSocial',
        'updatePost',
        'changeState',
        'postSocial',
        'updatePost',
        'inAppNotification',
        'sendWebhooks',
        'internalPlugs',
        'globalPlugs',
      ]);
    });

    it('asks for the patch only once a post is live', async () => {
      act('postSocial').mockRejectedValue(
        new ActivityFailure(
          'Activity task failed',
          'postSocial',
          '3',
          RetryState.NON_RETRYABLE_FAILURE,
          undefined,
          ApplicationFailure.create({ type: 'bad_body', nonRetryable: true })
        )
      );

      await run();

      expect(mockPatched).not.toHaveBeenCalled();
    });
  });
});
