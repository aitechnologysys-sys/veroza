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
import { YoutubeProvider } from '@gitroom/nestjs-libraries/integrations/social/youtube.provider';
import {
  readGoogleApiFailure,
  THUMBNAIL_WARNING_SUBJECT,
} from '@gitroom/nestjs-libraries/integrations/social/youtube.thumbnail.warning';

jest.mock('axios', () => ({ __esModule: true, default: jest.fn() }));

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
  ]);

describe('YoutubeProvider.post thumbnail handling', () => {
  let insert: jest.Mock;
  let setThumbnail: jest.Mock;
  let logged: jest.SpyInstance;

  beforeEach(() => {
    insert = jest.fn().mockResolvedValue({ data: { id: VIDEO_ID } });
    setThumbnail = jest.fn().mockResolvedValue({ data: {} });
    jest.spyOn(google, 'youtube').mockReturnValue({
      videos: { insert },
      thumbnails: { set: setThumbnail },
    } as any);
    (axios as unknown as jest.Mock).mockResolvedValue({ data: 'stream' });
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

  describe('when videos.insert succeeds and thumbnails.set fails', () => {
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
        // Only one upload, and post() resolved, so nothing retries it.
        expect(insert).toHaveBeenCalledTimes(1);
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
    insert.mockRejectedValue(
      googleError(400, 'invalidTitle', 'invalidTitle', 'youtube.video')
    );
    await expect(post({})).rejects.toMatchObject({ type: 'bad_body' });
    expect(setThumbnail).not.toHaveBeenCalled();
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
