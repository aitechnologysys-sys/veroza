import {
  AuthProvider,
  AuthProviderAbstract,
} from '@gitroom/backend/services/auth/providers.interface';

@AuthProvider({ provider: 'GENERIC' })
export class OauthProvider extends AuthProviderAbstract {
  private getConfig() {
    const {
      POSTARYX_OAUTH_AUTH_URL,
      POSTARYX_OAUTH_CLIENT_ID,
      POSTARYX_OAUTH_CLIENT_SECRET,
      POSTARYX_OAUTH_TOKEN_URL,
      POSTARYX_OAUTH_USERINFO_URL,
      POSTIZ_OAUTH_AUTH_URL,
      POSTIZ_OAUTH_CLIENT_ID,
      POSTIZ_OAUTH_CLIENT_SECRET,
      POSTIZ_OAUTH_TOKEN_URL,
      POSTIZ_OAUTH_USERINFO_URL,
      FRONTEND_URL,
    } = process.env;

    const authUrl = POSTARYX_OAUTH_AUTH_URL || POSTIZ_OAUTH_AUTH_URL;
    const clientId = POSTARYX_OAUTH_CLIENT_ID || POSTIZ_OAUTH_CLIENT_ID;
    const clientSecret =
      POSTARYX_OAUTH_CLIENT_SECRET || POSTIZ_OAUTH_CLIENT_SECRET;
    const tokenUrl = POSTARYX_OAUTH_TOKEN_URL || POSTIZ_OAUTH_TOKEN_URL;
    const userInfoUrl =
      POSTARYX_OAUTH_USERINFO_URL || POSTIZ_OAUTH_USERINFO_URL;

    if (
      !userInfoUrl ||
      !tokenUrl ||
      !clientId ||
      !clientSecret ||
      !authUrl ||
      !FRONTEND_URL
    ) {
      throw new Error(
        'POSTARYX_OAUTH environment variables are not set (POSTIZ_OAUTH_* is still accepted as a fallback)'
      );
    }

    return {
      authUrl,
      clientId,
      clientSecret,
      tokenUrl,
      userInfoUrl,
      frontendUrl: FRONTEND_URL,
    };
  }

  generateLink(): string {
    const { authUrl, clientId, frontendUrl } = this.getConfig();
    const params = new URLSearchParams({
      client_id: clientId,
      scope: 'openid profile email',
      response_type: 'code',
      redirect_uri: `${frontendUrl}/settings`,
    });

    return `${authUrl}?${params.toString()}`;
  }

  async getToken(code: string, _redirectUri?: string): Promise<string> {
    const { tokenUrl, clientId, clientSecret, frontendUrl } = this.getConfig();
    const response = await fetch(`${tokenUrl}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: `${frontendUrl}/settings`,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token request failed: ${error}`);
    }

    const { access_token } = await response.json();
    return access_token;
  }

  async getUser(access_token: string): Promise<{ email: string; id: string }> {
    const { userInfoUrl } = this.getConfig();
    const response = await fetch(`${userInfoUrl}`, {
      headers: {
        Authorization: `Bearer ${access_token}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`User info request failed: ${error}`);
    }

    const { email, sub: id } = await response.json();
    return { email, id };
  }
}
