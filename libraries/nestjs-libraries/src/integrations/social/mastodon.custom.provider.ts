import {
  ClientInformation,
  PostDetails,
  PostResponse,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { MastodonProvider } from '@gitroom/nestjs-libraries/integrations/social/mastodon.provider';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { Integration } from '@prisma/client';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

export class MastodonCustomProvider extends MastodonProvider {
  override identifier = 'mastodon-custom';
  override name = 'M. Instance';
  override maxConcurrentJob = 5; // Custom Mastodon instances typically have generous limits
  editor = 'normal' as const;

  async externalUrl(url: string) {
    const form = new FormData();
    form.append('client_name', 'Postaryx');
    form.append(
      'redirect_uris',
      `${process.env.FRONTEND_URL}/integrations/social/mastodon`
    );
    form.append('scopes', this.scopes.join(' '));
    form.append('website', process.env.FRONTEND_URL!);
    const { client_id, client_secret, ...all } = await (
      await fetch(url + '/api/v1/apps', {
        method: 'POST',
        body: form,
      })
    ).json();

    return {
      client_id,
      client_secret,
    };
  }
  override async generateAuthUrl(external?: ClientInformation) {
    const state = makeId(6);
    const url = this.generateUrlDynamic(
      external?.instanceUrl!,
      state,
      external?.client_id!,
      process.env.FRONTEND_URL!
    );

    return {
      url,
      codeVerifier: makeId(10),
      state,
    };
  }

  override async authenticate(
    params: {
      code: string;
      codeVerifier: string;
      refresh?: string;
    },
    clientInformation?: ClientInformation
  ) {
    return this.dynamicAuthenticate(
      clientInformation?.client_id!,
      clientInformation?.client_secret!,
      clientInformation?.instanceUrl!,
      params.code
    );
  }

  /**
   * The instance a channel was connected on. The OAuth callback stores the
   * external client information (client_id, client_secret, instanceUrl) encrypted
   * in `customInstanceDetails`; without it we would post every custom-instance
   * channel to mastodon.social with a token that server has never seen.
   */
  private instanceUrl(integration?: Integration): string {
    try {
      const details = JSON.parse(
        AuthService.fixedDecryption(integration?.customInstanceDetails!)
      ) as Partial<ClientInformation>;
      if (details?.instanceUrl) {
        return details.instanceUrl.replace(/\/+$/, '');
      }
    } catch {
      // fall through to the default instance
    }
    return process.env.MASTODON_URL || 'https://mastodon.social';
  }

  override async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    // Optional only to stay assignable to MastodonProvider.post, which upstream
    // declares with three parameters; the manager always passes it.
    integration?: Integration
  ): Promise<PostResponse[]> {
    return this.dynamicPost(
      id,
      accessToken,
      this.instanceUrl(integration),
      postDetails
    );
  }

  override async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    return this.dynamicComment(
      id,
      postId,
      lastCommentId,
      accessToken,
      this.instanceUrl(integration),
      postDetails
    );
  }
}
