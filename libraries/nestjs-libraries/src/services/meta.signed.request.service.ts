import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { MetaApp } from '@prisma/client';

/**
 * Meta sends deauthorization and data-deletion callbacks as a `signed_request`:
 * `<base64url signature>.<base64url payload>`, where the signature is an
 * HMAC-SHA256 of the *encoded* payload string keyed with the app secret.
 *
 * The user ID inside is app-scoped: the same person has a different ID under
 * every Meta app. A callback is therefore only ever meaningful for the
 * providers that share the app secret it was signed with, which is why every
 * method here is keyed on {@link MetaApp} rather than treating Meta as one
 * identity space.
 */

/** Which providers belong to which Meta app. */
export const META_APP_PROVIDERS: Record<MetaApp, string[]> = {
  // One app, one secret, one ID space — shared by both providers.
  FACEBOOK: ['facebook', 'instagram'],
  INSTAGRAM: ['instagram-standalone'],
  THREADS: ['threads'],
};

export interface MetaSignedRequestPayload {
  algorithm: string;
  issued_at?: number;
  expires?: number;
  user_id: string;
}

export interface VerifiedMetaRequest {
  app: MetaApp;
  userId: string;
  issuedAt?: number;
}

const ALLOWED_ALGORITHM = 'HMAC-SHA256';

@Injectable()
export class MetaSignedRequestService {
  /**
   * The secret each app signs with. Read lazily so a missing secret surfaces
   * as a rejected callback for that one app rather than a boot failure for an
   * instance that never enabled it.
   */
  private secretFor(app: MetaApp): string | undefined {
    switch (app) {
      case 'FACEBOOK':
        return process.env.FACEBOOK_APP_SECRET;
      case 'INSTAGRAM':
        return process.env.INSTAGRAM_APP_SECRET;
      case 'THREADS':
        return process.env.THREADS_APP_SECRET;
      default:
        return undefined;
    }
  }

  private static base64UrlDecode(value: string): Buffer {
    return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  }

  /**
   * Verify a signed_request against one app's secret.
   *
   * Returns null for every failure — bad shape, wrong algorithm, bad
   * signature, missing secret. The caller cannot tell these apart, and that is
   * deliberate: distinguishing them for an unauthenticated endpoint would leak
   * whether a given app is configured.
   */
  verify(signedRequest: string, app: MetaApp): VerifiedMetaRequest | null {
    const secret = this.secretFor(app);
    if (!secret || typeof signedRequest !== 'string') {
      return null;
    }

    // Exactly two parts. `split` with a limit would silently accept a third.
    const parts = signedRequest.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return null;
    }

    const [encodedSignature, encodedPayload] = parts;

    let payload: MetaSignedRequestPayload;
    try {
      payload = JSON.parse(
        MetaSignedRequestService.base64UrlDecode(encodedPayload).toString(
          'utf8'
        )
      );
    } catch {
      return null;
    }

    // Meta only ever signs with HMAC-SHA256. Refusing anything else stops a
    // forged payload from naming a weaker algorithm.
    if (payload?.algorithm?.toUpperCase() !== ALLOWED_ALGORITHM) {
      return null;
    }

    if (!payload?.user_id || typeof payload.user_id !== 'string') {
      return null;
    }

    const expected = createHmac('sha256', secret)
      .update(encodedPayload)
      .digest();
    const provided = MetaSignedRequestService.base64UrlDecode(encodedSignature);

    // timingSafeEqual throws on a length mismatch, so check that first.
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      return null;
    }

    return {
      app,
      userId: payload.user_id,
      issuedAt: payload.issued_at,
    };
  }

  /**
   * Verify when the caller did not say which app sent the callback.
   *
   * Meta posts deauthorization and deletion callbacks to whatever URL each app
   * is configured with, so routes are per-app and `verify` is preferred. This
   * exists for a shared route: it tries each configured app and returns the
   * first that validates. A forged request cannot match any secret, and a
   * genuine one can only match the app that signed it.
   */
  verifyAny(signedRequest: string): VerifiedMetaRequest | null {
    for (const app of Object.keys(META_APP_PROVIDERS) as MetaApp[]) {
      const verified = this.verify(signedRequest, app);
      if (verified) {
        return verified;
      }
    }
    return null;
  }

  /** The provider identifiers a verified callback is allowed to touch. */
  providersFor(app: MetaApp): string[] {
    return META_APP_PROVIDERS[app] || [];
  }
}
