import { ThrottlerGuard } from '@nestjs/throttler';
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  public override async canActivate(
    context: ExecutionContext
  ): Promise<boolean> {
    const { url, method } = context.switchToHttp().getRequest<Request>();
    if (method === 'POST' && url.includes('/public/v1/posts')) {
      return super.canActivate(context);
    }

    return true;
  }

  protected override async getTracker(
    req: Record<string, any>
  ): Promise<string> {
    // Only `POST /public/v1/posts` reaches this today, and that route is
    // authenticated, so `req.org` is always set and the bucket is unchanged.
    // The fallback matters if the allowlist above is ever widened to an
    // unauthenticated route — the Meta callbacks have no `req.org`, and
    // reading `.id` off undefined would turn every callback into a 500 that
    // Meta then retries. Falling back to the client address keeps such a
    // route rate-limited rather than broken.
    const scope = req.url.indexOf('/posts') > -1 ? 'posts' : 'other';
    return `${req.org?.id ?? req.ip}_${scope}`;
  }
}

// route-level guard for public endpoints, keyed by the client address the
// proxy forwards rather than the org the global guard expects
@Injectable()
export class ThrottlerRealIpGuard extends ThrottlerGuard {
  protected override async getTracker(
    req: Record<string, any>
  ): Promise<string> {
    const forwarded = String(req.headers?.['x-forwarded-for'] || '');
    return forwarded.split(',')[0].trim() || req.ip;
  }
}
