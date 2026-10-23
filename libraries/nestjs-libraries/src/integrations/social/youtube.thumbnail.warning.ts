import {
  redactSecretsInString,
  summarizeError,
} from '@gitroom/nestjs-libraries/helpers/redact';

/**
 * Turns a failed `thumbnails.set` into the warning shown to the user.
 *
 * The thumbnail is applied after `videos.insert` has already published the
 * video, so a failure here never means the post failed. This used to be
 * classified by substring-matching the whole serialized error, where
 * `youtube.thumbnail` (the error *domain* shared by every thumbnails.set
 * error) made every failure read "Your account is not verified". The reason
 * is now read from Google's structured response instead.
 *
 * Documented thumbnails.set errors:
 * https://developers.google.com/youtube/v3/docs/thumbnails/set#errors
 */

export interface GoogleApiFailure {
  status?: number;
  reason?: string;
  domain?: string;
  message?: string;
}

export const THUMBNAIL_WARNING_SUBJECT =
  'Video published on YouTube, but thumbnail not applied';

/** Reads status, reason, domain and message from a googleapis (Gaxios) error. */
export const readGoogleApiFailure = (err: unknown): GoogleApiFailure => {
  const anyErr = err as any;
  let data = anyErr?.response?.data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      data = undefined;
    }
  }

  const error = data?.error;
  const first = Array.isArray(error?.errors) ? error.errors[0] : undefined;
  const status =
    typeof anyErr?.response?.status === 'number'
      ? anyErr.response.status
      : typeof error?.code === 'number'
      ? error.code
      : undefined;
  const message = first?.message || error?.message;

  return {
    ...(status === undefined ? {} : { status }),
    ...(first?.reason ? { reason: String(first.reason) } : {}),
    ...(first?.domain ? { domain: String(first.domain) } : {}),
    ...(message
      ? { message: redactSecretsInString(String(message)).slice(0, 300) }
      : {}),
  };
};

const explain = (failure: GoogleApiFailure): string => {
  const { status, reason } = failure;

  if (reason === 'insufficientPermissions') {
    return 'The YouTube connection is missing the permission needed to set thumbnails. Reconnect the channel in Postaryx, then add the thumbnail in YouTube Studio.';
  }

  if (reason === 'forbidden' || (status === 403 && !reason)) {
    return "YouTube did not allow the thumbnail operation. Check your channel's custom-thumbnail permissions and feature eligibility in YouTube Studio.";
  }

  if (reason === 'invalidImage' || reason === 'mediaBodyRequired') {
    return 'YouTube rejected the thumbnail image. Use a valid JPEG or PNG image and add it in YouTube Studio.';
  }

  if (reason === 'uploadRateLimitExceeded' || status === 429) {
    return 'YouTube is temporarily limiting thumbnail uploads for this channel. Try adding the thumbnail in YouTube Studio later.';
  }

  if (reason === 'videoNotFound' || status === 404) {
    return 'YouTube could not find the uploaded video when the thumbnail was applied. It may still be processing or may have been removed. Check the video in YouTube Studio and add the thumbnail there.';
  }

  return 'Something went wrong while applying it. You can add the thumbnail in YouTube Studio.';
};

export const thumbnailWarning = (
  err: unknown,
  videoUrl: string
): { subject: string; message: string } => ({
  subject: THUMBNAIL_WARNING_SUBJECT,
  message: `Your video was successfully published to YouTube at ${videoUrl}, but we couldn't apply your custom thumbnail. ${explain(
    readGoogleApiFailure(err)
  )} You do not need to upload the video again.`,
});

/**
 * One scrubbed log line for the failure. summarizeError drops the request
 * config (Authorization header), the request and the raw body; only Google's
 * status, reason, domain and message are added back.
 */
export const logThumbnailFailure = (videoId: string, err: unknown) => {
  console.error(
    JSON.stringify({
      event: 'provider_error',
      provider: 'youtube',
      operation: 'thumbnails.set',
      videoId,
      ...summarizeError(err),
      google: readGoogleApiFailure(err),
    })
  );
};
