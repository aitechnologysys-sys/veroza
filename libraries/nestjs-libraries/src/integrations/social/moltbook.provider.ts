import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import {
  BadBody,
  SocialAbstract,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import axios from 'axios';
import { timer } from '@gitroom/helpers/utils/timer';

const MOLTBOOK_API_BASE = 'https://www.moltbook.com/api/v1';

// Moltbook write limits: 1 post per 30 min (1 per 2 h in an agent's first
// 24 h), 1 comment per 20 s (60 s for new agents). A cooldown that short is
// worth waiting out inside the activity; anything longer won't clear before
// Temporal's retries (3 × 2 min) run out, so fail once with a clear message.
const MAX_INLINE_WAIT_SECONDS = 90;
const MAX_INLINE_RETRIES = 3;

export class MoltbookProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 1; // Moltbook: 1 post / 30 min, 1 comment / 20 s
  identifier = 'moltbook';
  name = 'Moltbook';
  isBetweenSteps = false;
  scopes = [] as string[];
  isWeb3 = true;
  editor = 'normal' as const;

  maxLength() {
    return 300;
  }

  async refreshToken(refreshToken: string): Promise<AuthTokenDetails> {
    return {
      refreshToken: '',
      expiresIn: 0,
      accessToken: '',
      id: '',
      name: '',
      picture: '',
      username: '',
    };
  }

  async generateAuthUrl() {
    const state = makeId(6);
    return {
      url: state,
      codeVerifier: makeId(10),
      state,
    };
  }

  // POSTs to Moltbook, turning its errors into non-retryable BadBody failures
  // carrying Moltbook's own message. Plain axios errors would be retried by
  // Temporal, which only re-hits the cooldown.
  private async write(path: string, data: object, accessToken: string) {
    const body = JSON.stringify(data);
    for (let attempt = 0; ; attempt++) {
      const response = await axios.post(`${MOLTBOOK_API_BASE}${path}`, data, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        validateStatus: () => true,
      });

      if (response.status === 429) {
        const waitSeconds = Number(
          response.data?.retry_after_seconds ??
            (response.data?.retry_after_minutes != null
              ? response.data.retry_after_minutes * 60
              : response.headers?.['retry-after'] ?? 0)
        );

        if (
          waitSeconds > 0 &&
          waitSeconds <= MAX_INLINE_WAIT_SECONDS &&
          attempt < MAX_INLINE_RETRIES
        ) {
          await timer((waitSeconds + 1) * 1000);
          continue;
        }

        const minutes = Math.max(1, Math.ceil(waitSeconds / 60));
        throw new BadBody(
          this.identifier,
          JSON.stringify(response.data),
          body,
          `Moltbook rate limit: it allows 1 post every 30 minutes (every 2 hours for agents in their first day). Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
        );
      }

      if (response.status >= 400 || !response.data?.success) {
        throw new BadBody(
          this.identifier,
          JSON.stringify(response.data),
          body,
          response.data?.error ||
            response.data?.message ||
            `Moltbook request failed (HTTP ${response.status})`
        );
      }

      return response.data;
    }
  }

  async registerAgent(name: string, description: string) {
    const response = await axios.post(
      `${MOLTBOOK_API_BASE}/agents/register`,
      { name, description },
      { headers: { 'Content-Type': 'application/json' } }
    );

    if (!response.data.success) {
      throw new Error(response.data.error || 'Registration failed');
    }

    return response.data.agent;
  }

  async checkAgentStatus(apiKey: string) {
    const response = await axios.get(`${MOLTBOOK_API_BASE}/agents/status`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    return response.data;
  }

  async getAgentProfile(apiKey: string) {
    const response = await axios.get(`${MOLTBOOK_API_BASE}/agents/me`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.data.success) {
      throw new Error(response.data.error || 'Failed to get profile');
    }

    return response.data.agent;
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const apiKey = params.code;

    const profile = await this.getAgentProfile(apiKey);

    return {
      id: profile.name || profile.id,
      name: profile.display_name || profile.name,
      accessToken: apiKey,
      refreshToken: '',
      expiresIn: dayjs().add(200, 'year').unix() - dayjs().unix(),
      picture: '',
      username: profile.name,
    };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const results: PostResponse[] = [];

    for (const post of postDetails) {
      // The API field is `submolt_name` now; the saved setting keeps its
      // old `submolt` key so existing posts don't need migrating.
      const postData = {
        submolt_name: post.settings?.submolt || 'general',
        title: post.message.slice(0, 100),
        content: post.message,
      };

      const data = await this.write('/posts', postData, accessToken);

      const postId = data.post.id;
      results.push({
        id: post.id,
        postId: String(postId),
        releaseURL: `https://www.moltbook.com/post/${postId}`,
        // Unless the agent is trusted, Moltbook creates the post but hides it
        // from feeds until a maths challenge is answered through the API
        // within 5 minutes. We don't answer it, so report it honestly — the
        // workflow tells the user instead of saying "published".
        status:
          data.post.verification_status === 'pending'
            ? 'pending_verification'
            : 'completed',
      });
    }

    return results;
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const results: PostResponse[] = [];

    for (const post of postDetails) {
      const commentData: { content: string; parent_id?: string } = {
        content: post.message,
      };

      if (lastCommentId) {
        commentData.parent_id = lastCommentId;
      }

      const data = await this.write(
        `/posts/${postId}/comments`,
        commentData,
        accessToken
      );

      const commentId = data.comment.id;
      results.push({
        id: post.id,
        postId: String(commentId),
        releaseURL: `https://www.moltbook.com/post/${postId}`,
        status: 'completed',
      });
    }

    return results;
  }
}
