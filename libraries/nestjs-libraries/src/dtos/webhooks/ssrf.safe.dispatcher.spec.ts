import http from 'node:http';
import { AddressInfo } from 'node:net';

// Real sockets, controlled block list: 127.0.0.1 plays the "internal" target
// and IPv6 loopback plays a "public" host, so a redirect from one to the other
// can be exercised without DNS.
const blocked = new Set<string>(['127.0.0.1']);
jest.mock('./webhook.url.validator', () => ({
  isBlockedIp: (ip: string) => blocked.has(ip),
}));

import { getSsrfSafeAxios, ssrfSafeDispatcher } from './ssrf.safe.dispatcher';

const listen = (host: string, handler: http.RequestListener) =>
  new Promise<http.Server>((resolve, reject) => {
    const server = http.createServer(handler);
    server.once('error', reject);
    server.listen(0, host, () => resolve(server));
  });

const port = (server: http.Server) => (server.address() as AddressInfo).port;

const fetchVia = (url: string) =>
  fetch(url, { dispatcher: ssrfSafeDispatcher } as any);

const rootCause = (error: any): string => {
  let current = error;
  while (current?.cause) current = current.cause;
  return String(current?.message || current);
};

describe('SSRF-safe clients', () => {
  let internal: http.Server;
  let redirector: http.Server | undefined;

  beforeAll(async () => {
    internal = await listen('127.0.0.1', (_req, res) => res.end('secret'));
    try {
      redirector = await listen('::1', (_req, res) => {
        res.writeHead(302, {
          location: `http://127.0.0.1:${port(internal)}/`,
        });
        res.end();
      });
    } catch {
      redirector = undefined; // no IPv6 loopback on this machine
    }
  });

  afterAll(async () => {
    await new Promise((r) => internal.close(r));
    if (redirector) await new Promise((r) => redirector!.close(r));
  });

  describe('fetch with ssrfSafeDispatcher', () => {
    it('refuses a blocked IP literal', async () => {
      await expect(
        fetchVia(`http://127.0.0.1:${port(internal)}/`)
      ).rejects.toThrow();
      await fetchVia(`http://127.0.0.1:${port(internal)}/`).catch((e) =>
        expect(rootCause(e)).toBe('Blocked IP')
      );
    });

    it('refuses the decimal form of a blocked IP', async () => {
      await fetchVia(`http://2130706433:${port(internal)}/`).then(
        () => {
          throw new Error('request went through');
        },
        (e) => expect(rootCause(e)).toBe('Blocked IP')
      );
    });

    it('refuses a redirect to a blocked IP literal', async () => {
      if (!redirector) return;
      await fetchVia(`http://[::1]:${port(redirector)}/`).then(
        () => {
          throw new Error('redirect was followed');
        },
        (e) => expect(rootCause(e)).toBe('Blocked IP')
      );
    });

    it('still connects to allowed hosts', async () => {
      if (!redirector) return;
      const response = await fetch(`http://[::1]:${port(redirector)}/`, {
        dispatcher: ssrfSafeDispatcher,
        redirect: 'manual',
      } as any);
      expect(response.status).toBe(302);
    });
  });

  describe('axios from getSsrfSafeAxios', () => {
    it('refuses a blocked IP literal over http', async () => {
      await expect(
        getSsrfSafeAxios().get(`http://127.0.0.1:${port(internal)}/`)
      ).rejects.toThrow('Blocked IP');
    });

    it('refuses a blocked IP literal over https', async () => {
      await expect(
        getSsrfSafeAxios().get('https://127.0.0.1:9/')
      ).rejects.toThrow('Blocked IP');
    });

    it('refuses a redirect to a blocked IP literal', async () => {
      if (!redirector) return;
      await expect(
        getSsrfSafeAxios().get(`http://[::1]:${port(redirector)}/`)
      ).rejects.toThrow('Blocked IP');
    });

    it('still connects to allowed hosts', async () => {
      if (!redirector) return;
      const response = await getSsrfSafeAxios().get(
        `http://[::1]:${port(redirector)}/`,
        { maxRedirects: 0, validateStatus: () => true }
      );
      expect(response.status).toBe(302);
    });
  });
});
