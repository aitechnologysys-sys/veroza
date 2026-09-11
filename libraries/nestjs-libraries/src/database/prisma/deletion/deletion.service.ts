import { Injectable } from '@nestjs/common';
import { Integration } from '@prisma/client';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { MediaRepository } from '@gitroom/nestjs-libraries/database/prisma/media/media.repository';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';

/**
 * Reusable deletion primitives.
 *
 * Deletion in this product happens in several places — disconnecting one
 * channel, deleting one media item, and (later) removing a Workspace or an
 * Account. Each of those needs the same underlying steps: revoke upstream
 * authorization, erase stored credentials, remove objects from storage.
 *
 * Those steps live here so that every caller performs them identically and a
 * future account-deletion flow can be composed from them rather than
 * reimplementing the cleanup.
 *
 * Every method is best-effort with respect to third-party systems: a provider
 * that refuses a revoke call, or object storage that is briefly unavailable,
 * must never leave the local record intact. Local erasure is the part we
 * control and it always proceeds.
 */
@Injectable()
export class DeletionService {
  private _storage = UploadFactory.createStorage();

  constructor(
    private _integrationRepository: IntegrationRepository,
    private _integrationManager: IntegrationManager,
    private _mediaRepository: MediaRepository
  ) {}

  /**
   * Asks the platform to invalidate the authorization we hold.
   *
   * Providers opt in by implementing `revokeToken`; the rest are skipped. A
   * failure here is expected in normal operation — the user may already have
   * revoked access from the platform's own settings, which makes our call a
   * no-op — so it is reported, never thrown.
   */
  async revokeUpstream(integration: Integration): Promise<boolean> {
    try {
      const provider = this._integrationManager.getSocialIntegration(
        integration.providerIdentifier
      ) as { revokeToken?: (token: string) => Promise<unknown> } | undefined;

      if (!provider?.revokeToken || !integration.token) {
        return false;
      }

      await provider.revokeToken(integration.token);
      return true;
    } catch (err) {
      console.error(
        `Upstream revocation failed for integration ${integration.id}:`,
        err
      );
      return false;
    }
  }

  /**
   * Revokes upstream where supported, then erases the stored credentials.
   *
   * The credential erase is the guarantee: once this resolves, the row holds
   * no usable access token, refresh token or expiry, whatever the platform
   * did with our revoke request.
   */
  async purgeIntegrationCredentials(org: string, id: string) {
    const integration = await this._integrationRepository.getIntegrationById(
      org,
      id
    );

    if (!integration) {
      return { revoked: false, cleared: false };
    }

    const revoked = await this.revokeUpstream(integration);
    await this._integrationRepository.clearIntegrationCredentials(org, id);

    return { revoked, cleared: true };
  }

  /**
   * Removes a media item's bytes from the storage provider.
   *
   * Covers the thumbnail as well as the file itself — both are written by the
   * upload path, so both have to come back out. Storage failures are logged
   * and swallowed so the database record is still retired; an orphaned object
   * is recoverable, a database row pointing at deleted bytes is not.
   */
  async purgeMediaObject(media: {
    id: string;
    path?: string | null;
    thumbnail?: string | null;
  }): Promise<boolean> {
    const targets = [media.path, media.thumbnail].filter(
      (value): value is string => !!value
    );

    let removed = true;

    for (const target of targets) {
      try {
        await this._storage.removeFile(target);
      } catch (err) {
        removed = false;
        console.error(
          `Failed to remove stored object for media ${media.id} (${target}):`,
          err
        );
      }
    }

    return removed;
  }

  /**
   * Deletes one media item: bytes first, then the database record.
   *
   * Ordering matters. The record holds the only pointer to the object, so
   * retiring it first would strand the bytes with nothing left to find them.
   */
  async deleteMediaWithObject(org: string, id: string) {
    const media = await this._mediaRepository.getMediaById(id);

    if (media && media.organizationId === org) {
      await this.purgeMediaObject(media);
    }

    return this._mediaRepository.deleteMedia(org, id);
  }

  /**
   * Runs credential cleanup across every integration in a Workspace.
   *
   * Not wired to a route yet — it is the piece a Workspace or Account
   * deletion flow needs, and it is here so that flow does not have to
   * rediscover the revoke-then-erase sequence.
   */
  async purgeOrganizationCredentials(org: string) {
    const integrations =
      await this._integrationRepository.getIntegrationsList(org);

    const results = await Promise.all(
      integrations.map((integration) =>
        this.purgeIntegrationCredentials(org, integration.id)
      )
    );

    return {
      total: results.length,
      revoked: results.filter((result) => result.revoked).length,
    };
  }
}
