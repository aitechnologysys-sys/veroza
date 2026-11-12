import { OAuthService } from './oauth.service';

describe('OAuthService.registerDynamicClient redirect allowlist', () => {
  const env = { ...process.env };
  const repository = {
    deleteStaleDynamicApps: jest.fn().mockResolvedValue(undefined),
    createDynamicApp: jest.fn().mockImplementation(async (data: any) => ({
      ...data,
      createdAt: new Date(),
    })),
  };
  const service = new OAuthService(repository as any);

  const register = (redirect: string) =>
    service.registerDynamicClient({
      redirect_uris: [redirect],
      token_endpoint_auth_method: 'none',
    } as any);

  afterEach(() => {
    process.env = { ...env };
    jest.clearAllMocks();
  });

  it('refuses web callbacks when DCR_VERIFIED_DOMAINS is unset', async () => {
    delete process.env.DCR_VERIFIED_DOMAINS;
    await expect(register('https://evil.example/cb')).rejects.toMatchObject({
      response: { error: 'invalid_redirect_uri' },
    });
    expect(repository.createDynamicApp).not.toHaveBeenCalled();
  });

  it('still accepts loopback and native-app callbacks when unset', async () => {
    delete process.env.DCR_VERIFIED_DOMAINS;
    await expect(register('http://localhost:8787/callback')).resolves.toBeTruthy();
    await expect(
      register('cursor://anysphere.cursor-mcp/oauth/callback')
    ).resolves.toBeTruthy();
  });

  it('accepts listed domains and their subdomains, refuses the rest', async () => {
    process.env.DCR_VERIFIED_DOMAINS = 'claude.ai,chatgpt.com';
    await expect(
      register('https://claude.ai/api/mcp/auth_callback')
    ).resolves.toBeTruthy();
    await expect(
      register('https://www.chatgpt.com/connector_platform_oauth_redirect')
    ).resolves.toBeTruthy();
    await expect(register('https://claude.ai.evil.example/cb')).rejects.toMatchObject({
      response: { error: 'invalid_redirect_uri' },
    });
  });
});
