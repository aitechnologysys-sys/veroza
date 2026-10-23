import { Injectable, Optional } from '@nestjs/common';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

/**
 * Only the parts of the Redis client this service uses, so tests can supply a
 * fake without standing up Redis.
 */
export interface RedisScanner {
  scan(
    cursor: string,
    matchToken: 'MATCH',
    pattern: string,
    countToken: 'COUNT',
    count: number
  ): Promise<[string, string[]]>;
  del(...keys: string[]): Promise<number>;
}

export interface CacheCleanupResult {
  scanned: number;
  deleted: number;
  /** True when the scan hit its iteration ceiling before finishing. */
  truncated: boolean;
}

// Keep each round trip small so a big keyspace cannot stall Redis for other
// callers, and cap the loop so a pathological cursor cannot spin forever.
const SCAN_COUNT = 100;
const MAX_ITERATIONS = 1000;
const DELETE_BATCH = 100;

/**
 * Removes cached provider analytics.
 *
 * Two shapes are written, both prefixed with the organization:
 *   integration:{orgId}:{integrationId}:{date}   (integration.service.ts)
 *   integration:{orgId}:{postId}:{date}          (posts.service.ts)
 *
 * Every pattern here is anchored on `orgId`, so a cleanup can only ever reach
 * the owning tenant's keys — a deletion for one organization cannot touch
 * another's cache even if the IDs collided.
 */
@Injectable()
export class AnalyticsCacheService {
  // `RedisScanner` is an interface, so Nest emits `Object` for the parameter
  // type and cannot resolve it from the container. `@Optional()` makes it
  // inject `undefined` instead of throwing, which lets the default apply —
  // the shared client in production, a fake in tests.
  constructor(
    @Optional() private readonly redis: RedisScanner = ioRedis as any
  ) {}

  /**
   * Delete every cached analytics entry for one integration and its posts.
   *
   * Idempotent: a second run simply finds nothing. Safe to retry after a
   * partial failure, because deleting is per-batch and never depends on
   * earlier batches.
   */
  async clearIntegrationAnalytics(
    organizationId: string,
    integrationId: string,
    postIds: string[] = []
  ): Promise<CacheCleanupResult> {
    const total: CacheCleanupResult = {
      scanned: 0,
      deleted: 0,
      truncated: false,
    };

    // The integration's own analytics, plus one pattern per post. Post keys
    // are keyed by post id rather than integration id, so they cannot be
    // matched by a single wildcard without reaching other integrations.
    const patterns = [
      `integration:${organizationId}:${integrationId}:*`,
      ...postIds.map((id) => `integration:${organizationId}:${id}:*`),
    ];

    for (const pattern of patterns) {
      const result = await this.deleteByPattern(pattern);
      total.scanned += result.scanned;
      total.deleted += result.deleted;
      total.truncated = total.truncated || result.truncated;
    }

    return total;
  }

  private async deleteByPattern(pattern: string): Promise<CacheCleanupResult> {
    let cursor = '0';
    let iterations = 0;
    let scanned = 0;
    let deleted = 0;

    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        SCAN_COUNT
      );
      cursor = next;
      scanned += keys.length;

      for (let i = 0; i < keys.length; i += DELETE_BATCH) {
        const batch = keys.slice(i, i + DELETE_BATCH);
        if (batch.length) {
          // A key may expire between the scan and the delete; DEL simply
          // reports fewer removals, which is why `deleted` is a count and not
          // an assertion.
          deleted += await this.redis.del(...batch);
        }
      }

      iterations += 1;
    } while (cursor !== '0' && iterations < MAX_ITERATIONS);

    return { scanned, deleted, truncated: cursor !== '0' };
  }
}
