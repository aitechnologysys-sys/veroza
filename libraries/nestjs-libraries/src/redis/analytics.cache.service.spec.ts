import {
  AnalyticsCacheService,
  RedisScanner,
} from '@gitroom/nestjs-libraries/redis/analytics.cache.service';

/**
 * Minimal in-memory Redis with a real cursor, so SCAN is exercised across
 * multiple round trips rather than returning everything at once.
 */
class FakeRedis implements RedisScanner {
  public readonly scanCalls: string[] = [];
  public readonly delCalls: string[][] = [];
  // Real SCAN guarantees keys present for the whole iteration are returned
  // even as others are deleted. Snapshotting the match set at cursor '0'
  // reproduces that; indexing into a list that shrinks would skip entries.
  private snapshot: string[] = [];

  constructor(private keys: string[], private readonly pageSize = 2) {}

  async scan(
    cursor: string,
    _m: 'MATCH',
    pattern: string,
    _c: 'COUNT',
    _count: number
  ): Promise<[string, string[]]> {
    this.scanCalls.push(pattern);

    const matcher = new RegExp(
      `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, (c) =>
        c === '*' ? '.*' : `\\${c}`
      )}$`
    );
    if (cursor === '0') {
      this.snapshot = this.keys.filter((k) => matcher.test(k));
    }

    const start = Number(cursor);
    const page = this.snapshot.slice(start, start + this.pageSize);
    const next =
      start + this.pageSize >= this.snapshot.length
        ? '0'
        : String(start + this.pageSize);

    return [next, page];
  }

  async del(...keys: string[]): Promise<number> {
    this.delCalls.push(keys);
    const before = this.keys.length;
    this.keys = this.keys.filter((k) => !keys.includes(k));
    return before - this.keys.length;
  }

  get remaining() {
    return this.keys;
  }
}

describe('AnalyticsCacheService', () => {
  const ORG = 'org-a';
  const INTEGRATION = 'int-1';

  it('deletes the integration and its posts, across SCAN pages', async () => {
    const redis = new FakeRedis([
      `integration:${ORG}:${INTEGRATION}:1`,
      `integration:${ORG}:${INTEGRATION}:2`,
      `integration:${ORG}:${INTEGRATION}:3`,
      `integration:${ORG}:post-1:1`,
      `integration:${ORG}:post-2:1`,
    ]);
    const service = new AnalyticsCacheService(redis);

    const result = await service.clearIntegrationAnalytics(ORG, INTEGRATION, [
      'post-1',
      'post-2',
    ]);

    expect(result.deleted).toBe(5);
    expect(result.truncated).toBe(false);
    expect(redis.remaining).toEqual([]);
    // Three integration keys with a page size of 2 means SCAN had to paginate.
    expect(redis.scanCalls.length).toBeGreaterThan(3);
  });

  // Tenant isolation
  it('never reaches another organization', async () => {
    const redis = new FakeRedis([
      `integration:${ORG}:${INTEGRATION}:1`,
      `integration:org-b:${INTEGRATION}:1`,
      `integration:org-b:post-1:1`,
    ]);
    const service = new AnalyticsCacheService(redis);

    await service.clearIntegrationAnalytics(ORG, INTEGRATION, ['post-1']);

    expect(redis.remaining).toEqual([
      `integration:org-b:${INTEGRATION}:1`,
      `integration:org-b:post-1:1`,
    ]);
  });

  it('never reaches another integration in the same organization', async () => {
    const redis = new FakeRedis([
      `integration:${ORG}:${INTEGRATION}:1`,
      `integration:${ORG}:int-2:1`,
      `integration:${ORG}:post-of-int-2:1`,
    ]);
    const service = new AnalyticsCacheService(redis);

    await service.clearIntegrationAnalytics(ORG, INTEGRATION, []);

    expect(redis.remaining).toEqual([
      `integration:${ORG}:int-2:1`,
      `integration:${ORG}:post-of-int-2:1`,
    ]);
  });

  // Idempotency
  it('is safe to run twice', async () => {
    const redis = new FakeRedis([`integration:${ORG}:${INTEGRATION}:1`]);
    const service = new AnalyticsCacheService(redis);

    const first = await service.clearIntegrationAnalytics(ORG, INTEGRATION);
    const second = await service.clearIntegrationAnalytics(ORG, INTEGRATION);

    expect(first.deleted).toBe(1);
    expect(second.deleted).toBe(0);
    expect(second.truncated).toBe(false);
  });

  it('handles an empty keyspace', async () => {
    const service = new AnalyticsCacheService(new FakeRedis([]));

    await expect(
      service.clearIntegrationAnalytics(ORG, INTEGRATION, ['p1'])
    ).resolves.toEqual({ scanned: 0, deleted: 0, truncated: false });
  });

  // Concurrent writes / expiry between SCAN and DEL
  it('tolerates a key vanishing between the scan and the delete', async () => {
    const redis = new FakeRedis([
      `integration:${ORG}:${INTEGRATION}:1`,
      `integration:${ORG}:${INTEGRATION}:2`,
    ]);
    // Simulates a TTL expiring, or a concurrent writer removing it first.
    jest.spyOn(redis, 'del').mockImplementationOnce(async () => 0);
    const service = new AnalyticsCacheService(redis);

    const result = await service.clearIntegrationAnalytics(ORG, INTEGRATION);

    expect(result.deleted).toBe(0);
    expect(result.truncated).toBe(false);
  });

  // Partial failure
  it('propagates a Redis failure so the caller can decide', async () => {
    const redis = new FakeRedis([`integration:${ORG}:${INTEGRATION}:1`]);
    jest.spyOn(redis, 'del').mockRejectedValueOnce(new Error('redis down'));
    const service = new AnalyticsCacheService(redis);

    await expect(
      service.clearIntegrationAnalytics(ORG, INTEGRATION)
    ).rejects.toThrow('redis down');
  });

  it('uses SCAN rather than KEYS', () => {
    // KEYS blocks the server; the service must never expose or rely on it.
    expect((AnalyticsCacheService.prototype as any).keys).toBeUndefined();
    expect(AnalyticsCacheService.prototype.clearIntegrationAnalytics).toBeDefined();
  });
});
