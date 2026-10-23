import { PostResponse } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

/**
 * Text of the notification sent once the main post is live.
 *
 * Only the text depends on the result; the workflow sends it through the same
 * single inAppNotification call either way, so the command sequence a
 * running workflow replays is unchanged. Kept free of imports with side
 * effects because it runs inside the workflow sandbox.
 */
export const publishedNotification = (
  provider: string,
  result: PostResponse
): { subject: string; message: string; type: 'success' | 'info' } => {
  if (result.status === 'pending_verification') {
    return {
      subject: `Your post on ${provider} is waiting for verification`,
      message: `${provider} created your post at ${result.releaseURL} but keeps it hidden from feeds until its verification challenge is solved. ${provider} only sends that challenge to the posting app, so the post will stay hidden for now.`,
      type: 'info',
    };
  }

  if (result.warning) {
    return { ...result.warning, type: 'info' };
  }

  return {
    subject: `Your post has been published on ${provider}`,
    message: `Your post has been published on ${provider} at ${result.releaseURL}`,
    type: 'success',
  };
};
