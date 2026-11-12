import { isCrossSiteCookieRequest } from './csrf.origin.check';

const request = (overrides: {
  method?: string;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
}) =>
  ({
    method: overrides.method ?? 'POST',
    headers: overrides.headers ?? {},
    cookies: overrides.cookies ?? { auth: 'jwt' },
  } as any);

describe('isCrossSiteCookieRequest', () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://app.postaryx.com';
    process.env.MAIN_URL = 'https://postaryx.com/';
    delete process.env.CANVA_APP_ORIGIN;
  });

  afterAll(() => {
    process.env = env;
  });

  it('blocks a cookie-authenticated POST from another site', () => {
    expect(
      isCrossSiteCookieRequest(
        request({ headers: { origin: 'https://evil.example' } })
      )
    ).toBe(true);
  });

  it('blocks an opaque origin (sandboxed frame, data: URL)', () => {
    expect(
      isCrossSiteCookieRequest(request({ headers: { origin: 'null' } }))
    ).toBe(true);
  });

  it('blocks when only Fetch Metadata says cross-site', () => {
    expect(
      isCrossSiteCookieRequest(
        request({ headers: { 'sec-fetch-site': 'cross-site' } })
      )
    ).toBe(true);
  });

  it('allows our own frontends, ignoring case and trailing paths', () => {
    expect(
      isCrossSiteCookieRequest(
        request({ headers: { origin: 'https://APP.postaryx.com' } })
      )
    ).toBe(false);
    expect(
      isCrossSiteCookieRequest(
        request({ headers: { origin: 'https://postaryx.com' } })
      )
    ).toBe(false);
  });

  it('allows the Canva app origin only when configured', () => {
    const canva = request({
      headers: { origin: 'https://app-abc.canva-apps.com' },
    });
    expect(isCrossSiteCookieRequest(canva)).toBe(true);
    process.env.CANVA_APP_ORIGIN = 'https://app-abc.canva-apps.com/';
    expect(isCrossSiteCookieRequest(canva)).toBe(false);
  });

  it('ignores safe methods', () => {
    expect(
      isCrossSiteCookieRequest(
        request({ method: 'GET', headers: { origin: 'https://evil.example' } })
      )
    ).toBe(false);
  });

  it('ignores requests that authenticate with the auth header', () => {
    expect(
      isCrossSiteCookieRequest(
        request({
          headers: { origin: 'https://evil.example', auth: 'jwt' },
        })
      )
    ).toBe(false);
  });

  it('ignores requests without the auth cookie', () => {
    expect(
      isCrossSiteCookieRequest(
        request({ headers: { origin: 'https://evil.example' }, cookies: {} })
      )
    ).toBe(false);
  });

  it('allows non-browser callers that send no origin information', () => {
    expect(isCrossSiteCookieRequest(request({}))).toBe(false);
    expect(
      isCrossSiteCookieRequest(
        request({ headers: { 'sec-fetch-site': 'same-origin' } })
      )
    ).toBe(false);
  });
});
