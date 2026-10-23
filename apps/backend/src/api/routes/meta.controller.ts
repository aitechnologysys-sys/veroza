import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { MetaApp } from '@prisma/client';
import { MetaSignedRequestService } from '@gitroom/nestjs-libraries/services/meta.signed.request.service';
import { MetaDeletionService } from '@gitroom/nestjs-libraries/database/prisma/meta/meta.deletion.service';

/**
 * Meta's deauthorization and data-deletion callbacks.
 *
 * Unauthenticated by design — Meta calls these server to server with no
 * session. Authenticity comes from the HMAC on `signed_request`, so every
 * handler verifies before doing anything.
 *
 * Routes are per Meta app because the signature can only be checked against
 * the secret of the app that produced it, and because the user ID inside is
 * app-scoped: the same person has a different ID under each app.
 */

/** URL segment -> Meta app. Anything else is rejected. */
const APP_BY_SLUG: Record<string, MetaApp> = {
  // Serves both the `facebook` and `instagram` providers (one app, one secret).
  facebook: 'FACEBOOK',
  // `instagram-standalone`.
  instagram: 'INSTAGRAM',
  threads: 'THREADS',
};

@Controller('/meta')
export class MetaController {
  constructor(
    private _metaSignedRequestService: MetaSignedRequestService,
    private _metaDeletionService: MetaDeletionService
  ) {}

  /**
   * Called when a user removes the app. Meta ignores the body and only cares
   * that we answered, so this always returns 200 — including for a signature
   * we rejected, so a prober cannot use the status code as an oracle.
   */
  @Post('/:app/deauthorize')
  @HttpCode(200)
  async deauthorize(
    @Param('app') app: string,
    @Body() body: { signed_request?: string }
  ) {
    const metaApp = APP_BY_SLUG[app];
    if (!metaApp) {
      return { success: true };
    }

    const verified = this._metaSignedRequestService.verify(
      body?.signed_request || '',
      metaApp
    );

    if (!verified) {
      // Never echo the payload or say why it failed.
      console.warn(`Meta deauthorize: rejected an unverified request (${app})`);
      return { success: true };
    }

    const { request, isNew } = await this._metaDeletionService.accept(
      metaApp,
      verified.userId,
      'DEAUTHORIZE'
    );

    if (isNew) {
      await this.enqueueOrLeaveForReconciliation(request.id);
    }

    return { success: true };
  }

  /**
   * Called when a user asks for their data to be deleted. Meta requires a
   * `url` and `confirmation_code` in the response, and will retry if it does
   * not get them, so the work is queued rather than done inline.
   */
  @Post('/:app/data-deletion')
  @HttpCode(200)
  async dataDeletion(
    @Param('app') app: string,
    @Body() body: { signed_request?: string }
  ) {
    const metaApp = APP_BY_SLUG[app];
    const verified = metaApp
      ? this._metaSignedRequestService.verify(
          body?.signed_request || '',
          metaApp
        )
      : null;

    if (!verified || !metaApp) {
      // Meta treats a 400 here as a failed callback and retries. Say no more
      // than that the request was not accepted.
      console.warn(
        `Meta data deletion: rejected an unverified request (${app})`
      );
      return { error: 'invalid_request' };
    }

    const { request, isNew } = await this._metaDeletionService.accept(
      metaApp,
      verified.userId,
      'DATA_DELETION'
    );

    if (isNew) {
      await this.enqueueOrLeaveForReconciliation(request.id);
    }

    return {
      url: `${backendPublicUrl()}/meta/data-deletion/status/${request.confirmationCode}`,
      confirmation_code: request.confirmationCode,
    };
  }

  /**
   * Start the deletion workflow, but never fail the callback because of it.
   *
   * The request is already persisted. If Temporal is unreachable, answering
   * Meta with an error would be worse than useless: Meta retries, the retry
   * finds the existing open request and does not enqueue again, and the
   * request is stranded. Recording the failure and letting the reconciler
   * re-drive it keeps the obligation recoverable.
   */
  private async enqueueOrLeaveForReconciliation(requestId: string) {
    try {
      await this._metaDeletionService.enqueue(requestId);
    } catch {
      console.error(
        JSON.stringify({
          event: 'meta_deletion_enqueue_failed',
          requestId,
          note: 'left for reconciliation',
        })
      );
    }
  }

  /**
   * The human-readable status page Meta's response points at.
   *
   * Reachable by anyone holding the code, so it shows the status and nothing
   * else — no Meta user ID, no account, no channel names, no failure detail.
   */
  @Get('/data-deletion/status/:code')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async status(@Param('code') code: string) {
    const result = await this._metaDeletionService.publicStatus(code);

    const message = {
      not_found: 'We have no record of this deletion request.',
      pending: 'Your deletion request has been received and is queued.',
      processing: 'Your deletion request is being processed.',
      completed: 'Your data has been deleted.',
      failed:
        'Your deletion request could not be completed automatically and has been passed to our team. Please contact support if you need an update.',
    }[result.status];

    const received = result.receivedAt
      ? `<p>Received: ${escapeHtml(result.receivedAt)}</p>`
      : '';
    const completed = result.completedAt
      ? `<p>Completed: ${escapeHtml(result.completedAt)}</p>`
      : '';

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Data deletion request</title>
  </head>
  <body style="font-family: system-ui, sans-serif; max-width: 42rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.6;">
    <h1>Data deletion request</h1>
    <p>${escapeHtml(message)}</p>
    <p>Confirmation code: <code>${escapeHtml(code)}</code></p>
    ${received}
    ${completed}
  </body>
</html>`;
  }
}

/**
 * Public base URL of *this* service.
 *
 * The status page is served by this controller, so the URL handed to Meta has
 * to resolve to the backend. In production nginx puts the backend behind
 * `/api` and the frontend at `/`, so building the link from FRONTEND_URL would
 * point at the Next.js app, which has no such route.
 * NEXT_PUBLIC_BACKEND_URL already carries the right base in both environments
 * (`https://app.postaryx.com/api` in production, `http://localhost:3000`
 * locally).
 */
function backendPublicUrl() {
  return (process.env.NEXT_PUBLIC_BACKEND_URL || '').replace(/\/+$/, '');
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
