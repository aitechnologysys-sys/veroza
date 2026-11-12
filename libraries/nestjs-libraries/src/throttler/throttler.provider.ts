import { ThrottlerGuard } from '@nestjs/throttler';
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';

// Real client address for rate limits. Every reverse proxy in front of the
// backend appends the address it received the request from to
// X-Forwarded-For, so the client is the entry TRUSTED_PROXY_HOPS places from
// the right; anything further left was written by the client itself.
// Postaryx: upstream keys on the leftmost entry, which any caller can set to a
// fresh value per request and so never hit a limit. Production runs host nginx
// -> the container's nginx -> backend, i.e. TRUSTED_PROXY_HOPS=2. Unset = 1
// (the nearest proxy's view): spoof-proof, but may lump clients together.
export const clientIpFromRequest = (req: Record<string, any>): string => {
  const hops = Math.max(
    1,
    parseInt(process.env.TRUSTED_PROXY_HOPS || '1', 10) || 1
  );
  const chain = String(req.headers?.['x-forwarded-for'] || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (chain.length) {
    return chain[Math.max(0, chain.length - hops)];
  }

  return req.ip || 'unknown';
};

const isPublicComment = (method: string, url: string) =>
  method === 'POST' && /^\/public\/posts\/[^/]+\/comments/.test(url);

@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  public override async canActivate(
    context: ExecutionContext
  ): Promise<boolean> {
    const { url, method } = context.switchToHttp().getRequest<Request>();
    if (
      (method === 'POST' && url.includes('/public/v1/posts')) ||
      isPublicComment(method, url)
    ) {
      return super.canActivate(context);
    }

    return true;
  }

  protected override async getTracker(
    req: Record<string, any>
  ): Promise<string> {
    if (!req.org) {
      return 'ip_' + clientIpFromRequest(req);
    }

    return (
      req.org.id + '_' + (req.url.indexOf('/posts') > -1 ? 'posts' : 'other')
    );
  }
}

// route-level guard for public endpoints, keyed by the client address the
// proxy forwards rather than the org the global guard expects
@Injectable()
export class ThrottlerRealIpGuard extends ThrottlerGuard {
  protected override async getTracker(
    req: Record<string, any>
  ): Promise<string> {
    return clientIpFromRequest(req);
  }
}
