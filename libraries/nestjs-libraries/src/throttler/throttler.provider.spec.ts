import { clientIpFromRequest } from './throttler.provider';

describe('clientIpFromRequest', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  const req = (xff?: string, ip = '127.0.0.1') => ({
    headers: xff === undefined ? {} : { 'x-forwarded-for': xff },
    ip,
  });

  it('ignores entries the client wrote itself (spoofing)', () => {
    process.env.TRUSTED_PROXY_HOPS = '2';
    // client sent "1.2.3.4"; host nginx appended the real client, the
    // container nginx appended the host nginx address
    expect(clientIpFromRequest(req('1.2.3.4, 203.0.113.9, 172.17.0.1'))).toBe(
      '203.0.113.9'
    );
  });

  it('defaults to one hop: the nearest proxy, never a client-written entry', () => {
    delete process.env.TRUSTED_PROXY_HOPS;
    expect(clientIpFromRequest(req('1.2.3.4, 203.0.113.9'))).toBe(
      '203.0.113.9'
    );
  });

  it('falls back to the leftmost entry when the chain is shorter than the hops', () => {
    process.env.TRUSTED_PROXY_HOPS = '3';
    expect(clientIpFromRequest(req('203.0.113.9'))).toBe('203.0.113.9');
  });

  it('treats an invalid hop count as 1', () => {
    process.env.TRUSTED_PROXY_HOPS = 'abc';
    expect(clientIpFromRequest(req('1.2.3.4, 203.0.113.9'))).toBe(
      '203.0.113.9'
    );
  });

  it('uses the socket address when there is no X-Forwarded-For', () => {
    expect(clientIpFromRequest(req(undefined, '198.51.100.7'))).toBe(
      '198.51.100.7'
    );
  });
});
