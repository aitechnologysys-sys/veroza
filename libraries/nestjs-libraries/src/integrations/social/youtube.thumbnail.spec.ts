/**
 * A failed thumbnail must not fail a YouTube post.
 *
 * thumbnails.set runs after videos.insert has published the video. It used to
 * throw a non-retryable bad_body on any failure, so the post was marked ERROR,
 * its video ID was never saved, and every thumbnail error read "Your account
 * is not verified" because the classifier substring-matched the error domain
 * `youtube.thumbnail`. Production incident: workflow
 * post_cmvl4hwxn000euj4m39l0g06c, video MWqtPykvbcY (2026-10-23).
 *
 * The Google responses below mirror the documented thumbnails.set errors; the
 * 403 is the one stored for two local failures on 2026-10-12.
 */
import 'reflect-metadata';
import { google } from 'googleapis';
import { GaxiosError } from 'gaxios';
import axios from 'axios';
import { BadBody } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { YoutubeProvider } from '@gitroom/nestjs-libraries/integrations/social/youtube.provider';
import {
  readGoogleApiFailure,
  THUMBNAIL_WARNING_SUBJECT,
} from '@gitroom/nestjs-libraries/integrations/social/youtube.thumbnail.warning';

// The SSRF-safe client (upstream v2.24.0) calls axios.create() at module load;
// the provider downloads the thumbnail through it, so it is stubbed per test to
// return this same mock.
jest.mock('axios', () => {
  const mock: any = jest.fn();
  mock.create = jest.fn(() => mock);
  return { __esModule: true, default: mock };
});

const TOKEN = 'SYNTHETIC-access-token-must-never-be-logged';
const VIDEO_ID = 'MWqtPykvbcY';
const VIDEO_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;

const googleError = (
  status: number,
  reason: string,
  message: string,
  domain = 'youtube.thumbnail'
) => {
  const config = {
    url: `https://youtube.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${VIDEO_ID}&uploadType=media`,
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` },
  } as any;
  const data = {
    error: { code: status, message, errors: [{ message, domain, reason }] },
  };
  return new GaxiosError(message, config, {
    config,
    data,
    status,
    statusText: '',
    headers: {},
    request: { responseURL: config.url },
  } as any);
};

const FORBIDDEN = googleError(
  403,
  'forbidden',
  "The authenticated user doesn't have permissions to upload and set custom video thumbnails."
);

const post = (settings: Record<string, any>) =>
  new YoutubeProvider().post('channel-1', TOKEN, [
    {
      id: 'post-1',
      message: 'Description',
      settings: { title: 'Title', type: 'public', ...settings } as any,
      media: [{ path: 'https://cdn.example.test/video.mp4' } as any],
    },
  ], {} as any);

// Since upstream v2.23.0 the video goes up through a resumable session:
// postPending opens it, finalizePost streams the bytes and then sets the
// thumbnail. These tests start from a session whose upload already completed
// (pendingData.videoId is known), which is exactly the moment the thumbnail
// runs: the video is live, so nothing after this point may fail the post.
const completedSession = (thumbnail: string) => ({
  uploadUri: 'https://upload.example.test/session',
  videoSize: 1,
  path: 'https://cdn.example.test/video.mp4',
  uploadedBytes: 1,
  thumbnail,
  videoId: VIDEO_ID,
});

describe('YoutubeProvider.post thumbnail handling', () => {
  let postPending: jest.SpyInstance;
  let probeUploadSession: jest.SpyInstance;
  let setThumbnail: jest.Mock;
  let logged: jest.SpyInstance;

  beforeEach(() => {
    postPending = jest
      .spyOn(YoutubeProvider.prototype, 'postPending')
      .mockImplementation(async (_id, _token, details) => [
        {
          id: details[0].id,
          releaseURL: '',
          postId: '',
          status: 'pending',
          pendingData: completedSession(
            details[0].settings?.thumbnail?.path || ''
          ),
        },
      ]);
    // the upload already completed: asking the session again would mean the
    // provider is about to send video bytes a second time
    probeUploadSession = jest
      .spyOn(YoutubeProvider.prototype as any, 'probeUploadSession')
      .mockRejectedValue(new Error('must not re-probe a completed upload'));
    setThumbnail = jest.fn().mockResolvedValue({ data: {} });
    jest.spyOn(google, 'youtube').mockReturnValue({
      thumbnails: { set: setThumbnail },
    } as any);
    (axios as unknown as jest.Mock).mockResolvedValue({ data: 'stream' });
    jest
      .spyOn(YoutubeProvider.prototype as any, 'getSsrfSafeAxios')
      .mockReturnValue(axios);
    logged = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    (axios as unknown as jest.Mock).mockReset();
  });

  const published = {
    id: 'post-1',
    postId: VIDEO_ID,
    releaseURL: VIDEO_URL,
    status: 'success',
  };

  it('publishes normally without a custom thumbnail', async () => {
    await expect(post({})).resolves.toEqual([published]);
    expect(setThumbnail).not.toHaveBeenCalled();
  });

  it('publishes normally when the thumbnail is applied', async () => {
    await expect(
      post({ thumbnail: { path: 'https://cdn.example.test/thumb.png' } })
    ).resolves.toEqual([published]);
    expect(setThumbnail).toHaveBeenCalledWith({
      videoId: VIDEO_ID,
      media: { body: 'stream' },
    });
  });

  describe('when the upload completes and thumbnails.set fails', () => {
    const withThumbnail = () =>
      post({ thumbnail: { path: 'https://cdn.example.test/thumb.png' } });

    it.each([
      [
        '403 forbidden (channel not allowed custom thumbnails)',
        FORBIDDEN,
        "YouTube did not allow the thumbnail operation. Check your channel's custom-thumbnail permissions and feature eligibility in YouTube Studio.",
      ],
      [
        '403 insufficientPermissions (missing OAuth scope)',
        googleError(
          403,
          'insufficientPermissions',
          'Request had insufficient authentication scopes.',
          'global'
        ),
        'missing the permission needed to set thumbnails. Reconnect the channel',
      ],
      [
        '400 invalidImage',
        googleError(
          400,
          'invalidImage',
          'The provided image content is invalid.'
        ),
        'YouTube rejected the thumbnail image.',
      ],
      [
        '429 uploadRateLimitExceeded',
        googleError(
          429,
          'uploadRateLimitExceeded',
          'The channel has uploaded too many thumbnails recently.'
        ),
        'temporarily limiting thumbnail uploads',
      ],
      [
        '404 videoNotFound',
        googleError(
          404,
          'videoNotFound',
          'The video that you are trying to insert a thumbnail image for cannot be found.'
        ),
        'could not find the uploaded video',
      ],
      [
        'an unexpected 500',
        googleError(500, 'backendError', 'Backend Error', 'global'),
        'Something went wrong while applying it.',
      ],
      [
        'a 401 (which must not trigger a token refresh and re-upload)',
        googleError(401, 'authError', 'Invalid Credentials', 'global'),
        'Something went wrong while applying it.',
      ],
      [
        'a non-Google failure downloading the thumbnail',
        Object.assign(new Error('connect ECONNREFUSED'), {
          code: 'ECONNREFUSED',
        }),
        'Something went wrong while applying it.',
      ],
    ])(
      '%s: keeps the post published with a warning',
      async (_c, err, explanation) => {
        setThumbnail.mockRejectedValue(err);

        const [result] = await withThumbnail();

        expect(result).toMatchObject(published);
        expect(result.warning.subject).toBe(THUMBNAIL_WARNING_SUBJECT);
        expect(result.warning.message).toContain(VIDEO_URL);
        expect(result.warning.message).toContain(explanation);
        expect(result.warning.message).toContain(
          'You do not need to upload the video again.'
        );
        expect(result.warning.message).not.toMatch(/not verified/i);
        // Only one upload session, never re-probed, and post() resolved, so
        // nothing retries it.
        expect(postPending).toHaveBeenCalledTimes(1);
        expect(probeUploadSession).not.toHaveBeenCalled();
      }
    );

    it('uses the exact wording for a 403 forbidden', async () => {
      setThumbnail.mockRejectedValue(FORBIDDEN);
      const [result] = await withThumbnail();
      expect(result.warning).toEqual({
        subject: 'Video published on YouTube, but thumbnail not applied',
        message: `Your video was successfully published to YouTube at ${VIDEO_URL}, but we couldn't apply your custom thumbnail. YouTube did not allow the thumbnail operation. Check your channel's custom-thumbnail permissions and feature eligibility in YouTube Studio. You do not need to upload the video again.`,
      });
    });

    it('logs Google status, reason and message without the token', async () => {
      setThumbnail.mockRejectedValue(FORBIDDEN);
      await withThumbnail();

      expect(logged).toHaveBeenCalledTimes(1);
      const line = logged.mock.calls[0][0] as string;
      expect(line).not.toContain(TOKEN);
      expect(line).not.toMatch(/authorization/i);
      expect(JSON.parse(line)).toMatchObject({
        event: 'provider_error',
        provider: 'youtube',
        operation: 'thumbnails.set',
        videoId: VIDEO_ID,
        status: 403,
        google: {
          status: 403,
          reason: 'forbidden',
          domain: 'youtube.thumbnail',
          message:
            "The authenticated user doesn't have permissions to upload and set custom video thumbnails.",
        },
      });
    });
  });

  it('still fails the post when the video upload itself fails', async () => {
    // real postPending: YouTube refuses to open the upload session
    postPending.mockRestore();
    jest
      .spyOn(YoutubeProvider.prototype as any, 'youtubeMediaSize')
      .mockResolvedValue(1);
    const refused = new BadBody('youtube', '{}', '{}', 'invalidTitle');
    jest
      .spyOn(YoutubeProvider.prototype as any, 'fetch')
      .mockRejectedValue(refused);

    await expect(post({})).rejects.toBe(refused);
    expect(setThumbnail).not.toHaveBeenCalled();
  });
});

describe('YoutubeProvider.finalizePost thumbnail (postWorkflowV106 path)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (axios as unknown as jest.Mock).mockResolvedValue({ data: 'stream' });
    jest
      .spyOn(YoutubeProvider.prototype as any, 'getSsrfSafeAxios')
      .mockReturnValue(axios);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    (axios as unknown as jest.Mock).mockReset();
  });

  it('completes with a warning instead of throwing when the thumbnail fails', async () => {
    jest.spyOn(google, 'youtube').mockReturnValue({
      thumbnails: { set: jest.fn().mockRejectedValue(FORBIDDEN) },
    } as any);

    const result = await new YoutubeProvider().finalizePost(
      TOKEN,
      completedSession('https://cdn.example.test/thumb.png'),
      {} as any
    );

    expect(result).toMatchObject({
      status: 'completed',
      postId: VIDEO_ID,
      releaseURL: VIDEO_URL,
      warning: { subject: THUMBNAIL_WARNING_SUBJECT },
    });
  });

  it('completes without a warning when the thumbnail is applied', async () => {
    jest.spyOn(google, 'youtube').mockReturnValue({
      thumbnails: { set: jest.fn().mockResolvedValue({ data: {} }) },
    } as any);

    await expect(
      new YoutubeProvider().finalizePost(
        TOKEN,
        completedSession('https://cdn.example.test/thumb.png'),
        {} as any
      )
    ).resolves.toEqual({
      status: 'completed',
      postId: VIDEO_ID,
      releaseURL: VIDEO_URL,
    });
  });
});

describe('readGoogleApiFailure', () => {
  it('reads a body Google returned as a JSON string', () => {
    expect(
      readGoogleApiFailure({
        response: {
          status: 403,
          data: JSON.stringify({
            error: { errors: [{ reason: 'forbidden', message: 'No.' }] },
          }),
        },
      })
    ).toEqual({ status: 403, reason: 'forbidden', message: 'No.' });
  });

  it('returns nothing for an error without a Google response', () => {
    expect(readGoogleApiFailure(new Error('boom'))).toEqual({});
  });
});
