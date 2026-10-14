/**
 * End-to-end test for the Meta deletion lifecycle.
 *
 * Runs the real controller, services and repositories against a real
 * PostgreSQL and a real Redis — no database or cache mocks. The Temporal
 * *server* is not part of this: the workflow is a thin wrapper that calls the
 * activity and, on failure, records and alerts, so the activity is driven
 * directly in the order the workflow drives it. That gap is reported rather
 * than papered over.
 *
 * Infrastructure is throwaway and isolated (its own containers, network and
 * ports). It never touches the development stack.
 *
 * Skipped unless META_E2E_DATABASE_URL is set, so the normal suite stays
 * hermetic:
 *   META_E2E_DATABASE_URL=postgresql://e2e:e2e@localhost:55432/e2e \
 *   META_E2E_REDIS_URL=redis://localhost:56379 \
 *   pnpm exec jest -c jest.unit.config.js meta.deletion.e2e
 */
import { createHmac, randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { MetaSignedRequestService } from '@gitroom/nestjs-libraries/services/meta.signed.request.service';
import { MetaDeletionRepository } from '@gitroom/nestjs-libraries/database/prisma/meta/meta.deletion.repository';
import { MetaDeletionService } from '@gitroom/nestjs-libraries/database/prisma/meta/meta.deletion.service';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { AnalyticsCacheService } from '@gitroom/nestjs-libraries/redis/analytics.cache.service';
import { MetaController } from '@gitroom/backend/api/routes/meta.controller';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

const DATABASE_URL = process.env.META_E2E_DATABASE_URL;
const REDIS_URL = process.env.META_E2E_REDIS_URL;
const describeE2E = DATABASE_URL && REDIS_URL ? describe : describe.skip;

// Importing the modules above constructs the shared Redis client in
// redis.service.ts as an import side effect, before any test runs. When this
// suite is skipped Jest runs no hook for this file, so nothing would close
// that socket and the whole run hangs after the last test. Release it here;
// when the suite is enabled the hooks own it instead.
if (!DATABASE_URL || !REDIS_URL) {
  (ioRedis as any)?.disconnect?.();
}

const FACEBOOK_SECRET = 'e2e-facebook-secret';
const THREADS_SECRET = 'e2e-threads-secret';

const b64url = (v: Buffer | string) =>
  Buffer.from(v as any).toString('base64url');

const sign = (userId: string, secret: string) => {
  const payload = b64url(
    JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: userId })
  );
  return `${b64url(
    createHmac('sha256', secret).update(payload).digest()
  )}.${payload}`;
};

describeE2E('Meta deletion lifecycle (e2e)', () => {
  let prisma: PrismaClient;
  let redis: Redis;
  let controller: MetaController;
  let deletionService: MetaDeletionService;
  let enqueued: string[];

  // Synthetic identities. Nothing here resembles a real Meta account.
  const TENANT_A = `e2e-org-a-${randomUUID()}`;
  const TENANT_B = `e2e-org-b-${randomUUID()}`;
  const META_USER = `e2e-fb-user-${randomUUID()}`;
  const OTHER_META_USER = `e2e-fb-other-${randomUUID()}`;

  const seedIntegration = async (opts: {
    organizationId: string;
    providerIdentifier: string;
    rootInternalId: string;
  }) => {
    const id = randomUUID();
    await prisma.integration.create({
      data: {
        id,
        name: 'E2E channel',
        internalId: `page-${randomUUID()}`,
        rootInternalId: opts.rootInternalId,
        providerIdentifier: opts.providerIdentifier,
        organizationId: opts.organizationId,
        token: 'e2e-access-token',
        refreshToken: 'e2e-refresh-token',
        picture: 'https://example.invalid/avatar.png',
        profile: 'e2e-profile',
        type: 'social',
      } as any,
    });
    return id;
  };

  beforeAll(async () => {
    process.env.FACEBOOK_APP_SECRET = FACEBOOK_SECRET;
    process.env.THREADS_APP_SECRET = THREADS_SECRET;
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://app.postaryx.com/api';

    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    await prisma.$connect();
    redis = new Redis(REDIS_URL!);

    for (const org of [TENANT_A, TENANT_B]) {
      await prisma.organization.create({
        data: { id: org, name: org } as any,
      });
    }

    const wrap = (p: PrismaClient) => ({ model: p } as any);
    const integrationRepository = new IntegrationRepository(
      wrap(prisma),
      wrap(prisma),
      wrap(prisma),
      wrap(prisma),
      wrap(prisma),
      wrap(prisma)
    );
    const deletionRepository = new MetaDeletionRepository(wrap(prisma));
    const analyticsCache = new AnalyticsCacheService(redis as any);

    enqueued = [];
    deletionService = new MetaDeletionService(
      deletionRepository,
      integrationRepository,
      // No provider revocation in E2E: the tokens are synthetic and must never
      // reach Meta.
      { getSocialIntegration: () => ({}) } as any,
      { client: { getRawClient: () => undefined } } as any,
      analyticsCache
    );
    // Record enqueues instead of starting a Temporal workflow.
    (deletionService as any).enqueue = async (id: string) => {
      enqueued.push(id);
    };

    controller = new MetaController(
      new MetaSignedRequestService(),
      deletionService
    );
  }, 60000);

  afterAll(async () => {
    await prisma?.$disconnect();
    redis?.disconnect();
  });

  it('runs the full lifecycle: callback -> db -> workflow -> scrub -> cache -> status', async () => {
    const target = await seedIntegration({
      organizationId: TENANT_A,
      providerIdentifier: 'facebook',
      rootInternalId: META_USER,
    });
    const post = await prisma.post.create({
      data: {
        id: randomUUID(),
        content: 'e2e synthetic post',
        publishDate: new Date(),
        organizationId: TENANT_A,
        integrationId: target,
        state: 'PUBLISHED',
        group: randomUUID(),
        releaseId: 'meta-release-123',
        releaseURL: 'https://facebook.invalid/post/123',
      } as any,
    });

    // Cached analytics for the target, plus a decoy in the other tenant.
    await redis.set(`integration:${TENANT_A}:${target}:1`, '{"views":1}');
    await redis.set(`integration:${TENANT_A}:${target}:2`, '{"views":2}');
    await redis.set(`integration:${TENANT_A}:${post.id}:1`, '{"views":3}');
    await redis.set(`integration:${TENANT_B}:decoy:1`, '{"views":9}');

    // 1. HTTP callback with a genuine signature.
    const response: any = await controller.dataDeletion('facebook', {
      signed_request: sign(META_USER, FACEBOOK_SECRET),
    });

    expect(response.confirmation_code).toEqual(expect.any(String));
    expect(response.url).toBe(
      `https://app.postaryx.com/api/meta/data-deletion/status/${response.confirmation_code}`
    );

    // 2. Persisted and queued.
    const stored = await prisma.metaDeletionRequest.findUnique({
      where: { confirmationCode: response.confirmation_code },
    });
    expect(stored).toMatchObject({
      metaApp: 'FACEBOOK',
      metaUserId: META_USER,
      callbackType: 'DATA_DELETION',
      status: 'PENDING',
    });
    expect(enqueued).toContain(stored!.id);

    // 3. Status before processing.
    expect((await deletionService.publicStatus(response.confirmation_code)).status).toBe(
      'pending'
    );

    // 4. The work the workflow drives.
    const result = await deletionService.process(stored!.id);
    expect(result).toEqual({ matched: 1, status: 'COMPLETED' });

    // 5. Credentials and cached Meta profile gone; the post survives but
    //    loses its Meta receipts.
    const scrubbed = await prisma.integration.findUnique({
      where: { id: target },
    });
    expect(scrubbed).toMatchObject({
      token: '',
      refreshToken: null,
      picture: null,
      profile: null,
      rootInternalId: null,
      disabled: true,
    });
    expect(scrubbed!.deletedAt).not.toBeNull();
    expect(scrubbed!.internalId).toMatch(/^deleted_/);

    const keptPost = await prisma.post.findUnique({ where: { id: post.id } });
    expect(keptPost!.content).toBe('e2e synthetic post');
    expect(keptPost!.releaseId).toBeNull();
    expect(keptPost!.releaseURL).toBeNull();

    // 6. Cache cleared for this integration only.
    expect(await redis.keys(`integration:${TENANT_A}:*`)).toEqual([]);
    expect(await redis.get(`integration:${TENANT_B}:decoy:1`)).toBe(
      '{"views":9}'
    );

    // 7. Status afterwards.
    const status = await deletionService.publicStatus(
      response.confirmation_code
    );
    expect(status.status).toBe('completed');
    expect(status.completedAt).toEqual(expect.any(String));
    expect(JSON.stringify(status)).not.toContain(META_USER);
  }, 60000);

  it('isolates tenants and other Meta identities', async () => {
    const victim = await seedIntegration({
      organizationId: TENANT_A,
      providerIdentifier: 'facebook',
      rootInternalId: OTHER_META_USER,
    });
    const otherTenant = await seedIntegration({
      organizationId: TENANT_B,
      providerIdentifier: 'facebook',
      rootInternalId: OTHER_META_USER,
    });
    // Same ID under a different Meta app — a different person.
    const threads = await seedIntegration({
      organizationId: TENANT_A,
      providerIdentifier: 'threads',
      rootInternalId: OTHER_META_USER,
    });

    const res: any = await controller.dataDeletion('facebook', {
      signed_request: sign(OTHER_META_USER, FACEBOOK_SECRET),
    });
    const row = await prisma.metaDeletionRequest.findUnique({
      where: { confirmationCode: res.confirmation_code },
    });
    const result = await deletionService.process(row!.id);

    // Both Facebook rows share the identity under the same app, so both go.
    expect(result.matched).toBe(2);
    for (const id of [victim, otherTenant]) {
      const row2 = await prisma.integration.findUnique({ where: { id } });
      expect(row2!.token).toBe('');
    }

    // The Threads row is untouched: different app, different ID space.
    const threadsRow = await prisma.integration.findUnique({
      where: { id: threads },
    });
    expect(threadsRow!.token).toBe('e2e-access-token');
    expect(threadsRow!.deletedAt).toBeNull();
  }, 60000);

  it('is idempotent across duplicate callbacks', async () => {
    const userId = `e2e-dup-${randomUUID()}`;
    await seedIntegration({
      organizationId: TENANT_A,
      providerIdentifier: 'facebook',
      rootInternalId: userId,
    });

    const first: any = await controller.dataDeletion('facebook', {
      signed_request: sign(userId, FACEBOOK_SECRET),
    });
    const replay: any = await controller.dataDeletion('facebook', {
      signed_request: sign(userId, FACEBOOK_SECRET),
    });

    expect(replay.confirmation_code).toBe(first.confirmation_code);
    expect(
      await prisma.metaDeletionRequest.count({
        where: { metaUserId: userId },
      })
    ).toBe(1);

    const row = await prisma.metaDeletionRequest.findUnique({
      where: { confirmationCode: first.confirmation_code },
    });
    await deletionService.process(row!.id);
    // Re-processing a settled request must not run the deletion again.
    const second = await deletionService.process(row!.id);
    expect(second.status).toBe('COMPLETED');
    expect(
      (await prisma.metaDeletionRequest.findUnique({ where: { id: row!.id } }))!
        .attempts
    ).toBe(1);
  }, 60000);

  it('records a verified callback that maps to nothing as UNMATCHED', async () => {
    const ghost = `e2e-ghost-${randomUUID()}`;

    const res: any = await controller.dataDeletion('facebook', {
      signed_request: sign(ghost, FACEBOOK_SECRET),
    });
    const row = await prisma.metaDeletionRequest.findUnique({
      where: { confirmationCode: res.confirmation_code },
    });
    const result = await deletionService.process(row!.id);

    expect(result).toEqual({ matched: 0, status: 'UNMATCHED' });
    // Publicly indistinguishable from completed, so it confirms nothing.
    expect((await deletionService.publicStatus(res.confirmation_code)).status).toBe(
      'completed'
    );
  }, 60000);

  it('rejects a forged signature and a cross-app replay', async () => {
    const before = await prisma.metaDeletionRequest.count();

    await expect(
      controller.dataDeletion('facebook', { signed_request: 'garbage' })
    ).resolves.toEqual({ error: 'invalid_request' });

    // Genuine Threads signature replayed at the Facebook endpoint.
    await expect(
      controller.dataDeletion('facebook', {
        signed_request: sign('someone', THREADS_SECRET),
      })
    ).resolves.toEqual({ error: 'invalid_request' });

    expect(await prisma.metaDeletionRequest.count()).toBe(before);
  }, 60000);

  it('retries and recovers when Redis is unavailable mid-deletion', async () => {
    const userId = `e2e-retry-${randomUUID()}`;
    const integrationId = await seedIntegration({
      organizationId: TENANT_A,
      providerIdentifier: 'facebook',
      rootInternalId: userId,
    });
    await redis.set(`integration:${TENANT_A}:${integrationId}:1`, '{"v":1}');

    const res: any = await controller.dataDeletion('facebook', {
      signed_request: sign(userId, FACEBOOK_SECRET),
    });
    const row = await prisma.metaDeletionRequest.findUnique({
      where: { confirmationCode: res.confirmation_code },
    });

    // Simulate Redis being down for the first attempt.
    const cache = (deletionService as any)._analyticsCacheService;
    const original = cache.clearIntegrationAnalytics.bind(cache);
    cache.clearIntegrationAnalytics = async () => {
      throw new Error('redis unavailable');
    };

    await expect(deletionService.process(row!.id)).rejects.toThrow();

    const midway = await prisma.metaDeletionRequest.findUnique({
      where: { id: row!.id },
    });
    // Must not claim success while cached Meta data may remain.
    expect(midway!.status).toBe('PROCESSING');

    // Redis comes back; the retry resumes and finishes.
    cache.clearIntegrationAnalytics = original;
    const result = await deletionService.process(row!.id);

    expect(result).toEqual({ matched: 1, status: 'COMPLETED' });
    expect(
      await redis.keys(`integration:${TENANT_A}:${integrationId}:*`)
    ).toEqual([]);
    const finished = await prisma.metaDeletionRequest.findUnique({
      where: { id: row!.id },
    });
    expect(finished!.attempts).toBe(2);
  }, 60000);
});
