/**
 * Temporal end-to-end test for the Meta deletion lifecycle.
 *
 * Unlike meta.deletion.e2e.spec.ts, this drives a **real Temporal server**: the
 * real workflow is bundled and registered in a real Worker alongside the real
 * activity, which is wired to a real PostgreSQL and a real Redis. The only
 * thing faked is upstream Meta revocation, because the tokens are synthetic and
 * must never leave the machine.
 *
 * Infrastructure is disposable and isolated — its own containers, network and
 * ports. It never touches the postiz-dev stack.
 *
 * Skipped unless META_E2E_TEMPORAL_ADDRESS is set:
 *   META_E2E_DATABASE_URL=postgresql://e2e:e2e@localhost:55432/e2e \
 *   META_E2E_REDIS_URL=redis://localhost:56379 \
 *   META_E2E_TEMPORAL_ADDRESS=localhost:57233 \
 *   pnpm exec jest -c jest.unit.config.js meta.deletion.temporal --runInBand
 */
import { createHmac, randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { Worker, NativeConnection } from '@temporalio/worker';
import { Client, Connection } from '@temporalio/client';
import { MetaSignedRequestService } from '@gitroom/nestjs-libraries/services/meta.signed.request.service';
import { MetaDeletionRepository } from '@gitroom/nestjs-libraries/database/prisma/meta/meta.deletion.repository';
import { MetaDeletionService } from '@gitroom/nestjs-libraries/database/prisma/meta/meta.deletion.service';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { AnalyticsCacheService } from '@gitroom/nestjs-libraries/redis/analytics.cache.service';
import { MetaComplianceAlertService } from '@gitroom/nestjs-libraries/services/meta.compliance.alert.service';
import { MetaActivity } from '@gitroom/orchestrator/activities/meta.activity';
import { MetaController } from '@gitroom/backend/api/routes/meta.controller';

const DATABASE_URL = process.env.META_E2E_DATABASE_URL;
const REDIS_URL = process.env.META_E2E_REDIS_URL;
const TEMPORAL_ADDRESS = process.env.META_E2E_TEMPORAL_ADDRESS;
const enabled = DATABASE_URL && REDIS_URL && TEMPORAL_ADDRESS;
const describeTemporal = enabled ? describe : describe.skip;

const FACEBOOK_SECRET = 'e2e-facebook-secret';
// The workflow pins its activities to the 'main' queue (see
// meta.deletion.workflow.ts), so the worker has to listen there or the
// activity tasks are never delivered. Safe here: this Temporal server is
// disposable and has no other workers attached.
const TASK_QUEUE = 'main';

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

describeTemporal('Meta deletion through a real Temporal server (e2e)', () => {
  let prisma: PrismaClient;
  let redis: Redis;
  let worker: Worker;
  let workerRun: Promise<void>;
  let client: Client;
  let connection: Connection;
  let nativeConnection: NativeConnection;
  let controller: MetaController;
  let deletionService: MetaDeletionService;
  let analyticsCache: AnalyticsCacheService;

  const ORG = `e2e-org-${randomUUID()}`;

  const seedIntegration = async (rootInternalId: string) => {
    const id = randomUUID();
    await prisma.integration.create({
      data: {
        id,
        name: 'E2E channel',
        internalId: `page-${randomUUID()}`,
        rootInternalId,
        providerIdentifier: 'facebook',
        organizationId: ORG,
        token: 'e2e-access-token',
        refreshToken: 'e2e-refresh-token',
        picture: 'https://example.invalid/a.png',
        profile: 'e2e-profile',
        type: 'social',
      } as any,
    });
    return id;
  };

  beforeAll(async () => {
    process.env.FACEBOOK_APP_SECRET = FACEBOOK_SECRET;
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://app.postaryx.com/api';

    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    await prisma.$connect();
    redis = new Redis(REDIS_URL!);

    await prisma.organization.create({
      data: { id: ORG, name: ORG } as any,
    });

    const wrap = (p: PrismaClient) => ({ model: p } as any);
    const integrationRepository = new IntegrationRepository(
      wrap(prisma),
      wrap(prisma),
      wrap(prisma),
      wrap(prisma),
      wrap(prisma),
      wrap(prisma)
    );
    analyticsCache = new AnalyticsCacheService(redis as any);

    deletionService = new MetaDeletionService(
      new MetaDeletionRepository(wrap(prisma)),
      integrationRepository,
      // Synthetic tokens must never be sent to Meta.
      { getSocialIntegration: () => ({}) } as any,
      {} as any,
      analyticsCache
    );

    // The real activity, wired to the real services.
    const activity = new MetaActivity(
      deletionService,
      new MetaComplianceAlertService()
    );

    nativeConnection = await NativeConnection.connect({
      address: TEMPORAL_ADDRESS,
    });

    // The real workflow file, bundled and registered as the orchestrator does.
    worker = await Worker.create({
      connection: nativeConnection,
      taskQueue: TASK_QUEUE,
      // The compiled workflow, which is what the orchestrator actually loads.
      // Bundling the .ts source instead makes Temporal's swc-loader read
      // apps/orchestrator/.swcrc, whose `baseUrl` is an absolute path from the
      // upstream author's machine and fails to resolve anywhere else.
      workflowsPath: require.resolve(
        '../../../../../../apps/orchestrator/dist/apps/orchestrator/src/workflows/meta.deletion.workflow.js'
      ),
      activities: {
        processMetaDeletion: (id: string) => activity.processMetaDeletion(id),
        failMetaDeletion: (id: string, reason: string) =>
          activity.failMetaDeletion(id, reason),
        alertMetaDeletionFailure: (id: string, reason?: string) =>
          activity.alertMetaDeletionFailure(id, reason),
      },
    });
    workerRun = worker.run();

    connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
    client = new Client({ connection });

    // Enqueue onto this test's own task queue.
    (deletionService as any).enqueue = async (requestId: string) => {
      await client.workflow.start('metaDeletionWorkflow', {
        args: [{ requestId }],
        workflowId: `meta_deletion_${requestId}`,
        taskQueue: TASK_QUEUE,
        workflowIdConflictPolicy: 'USE_EXISTING',
      });
    };

    controller = new MetaController(
      new MetaSignedRequestService(),
      deletionService
    );
  }, 180000);

  afterAll(async () => {
    worker?.shutdown();
    await workerRun?.catch(() => undefined);
    await connection?.close().catch(() => undefined);
    await nativeConnection?.close().catch(() => undefined);
    await prisma?.$disconnect();
    redis?.disconnect();
  }, 60000);

  it('completes the whole lifecycle through the Temporal server', async () => {
    const metaUser = `e2e-fb-${randomUUID()}`;
    const integrationId = await seedIntegration(metaUser);
    await redis.set(`integration:${ORG}:${integrationId}:1`, '{"views":1}');

    // HTTP callback with a genuine signature.
    const response: any = await controller.dataDeletion('facebook', {
      signed_request: sign(metaUser, FACEBOOK_SECRET),
    });
    expect(response.confirmation_code).toEqual(expect.any(String));

    const row = await prisma.metaDeletionRequest.findUnique({
      where: { confirmationCode: response.confirmation_code },
    });

    // Wait on the real workflow execution.
    const handle = client.workflow.getHandle(`meta_deletion_${row!.id}`);
    const result = await handle.result();

    expect(result).toEqual({ matched: 1, status: 'COMPLETED' });

    const scrubbed = await prisma.integration.findUnique({
      where: { id: integrationId },
    });
    expect(scrubbed).toMatchObject({ token: '', refreshToken: null });
    expect(await redis.keys(`integration:${ORG}:${integrationId}:*`)).toEqual(
      []
    );

    const status = await deletionService.publicStatus(
      response.confirmation_code
    );
    expect(status.status).toBe('completed');
    expect(JSON.stringify(status)).not.toContain(metaUser);
  }, 180000);

  it('retries a transient failure and recovers within the same workflow', async () => {
    const metaUser = `e2e-retry-${randomUUID()}`;
    const integrationId = await seedIntegration(metaUser);
    await redis.set(`integration:${ORG}:${integrationId}:1`, '{"views":1}');

    // Fail the first attempt only; Temporal's retry policy should carry it.
    const real = analyticsCache.clearIntegrationAnalytics.bind(analyticsCache);
    let attempts = 0;
    (analyticsCache as any).clearIntegrationAnalytics = async (
      ...args: any[]
    ) => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('redis unavailable (synthetic)');
      }
      return (real as any)(...args);
    };

    const response: any = await controller.dataDeletion('facebook', {
      signed_request: sign(metaUser, FACEBOOK_SECRET),
    });
    const row = await prisma.metaDeletionRequest.findUnique({
      where: { confirmationCode: response.confirmation_code },
    });

    const handle = client.workflow.getHandle(`meta_deletion_${row!.id}`);
    const result = await handle.result();

    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(result).toEqual({ matched: 1, status: 'COMPLETED' });

    const settled = await prisma.metaDeletionRequest.findUnique({
      where: { id: row!.id },
    });
    expect(settled!.status).toBe('COMPLETED');
    // Re-claimed by the retry rather than silently skipped.
    expect(settled!.attempts).toBeGreaterThanOrEqual(2);
    expect(await redis.keys(`integration:${ORG}:${integrationId}:*`)).toEqual(
      []
    );

    (analyticsCache as any).clearIntegrationAnalytics = real;
  }, 180000);

  it('a replayed callback reuses the running workflow', async () => {
    const metaUser = `e2e-dup-${randomUUID()}`;
    await seedIntegration(metaUser);

    const first: any = await controller.dataDeletion('facebook', {
      signed_request: sign(metaUser, FACEBOOK_SECRET),
    });
    const replay: any = await controller.dataDeletion('facebook', {
      signed_request: sign(metaUser, FACEBOOK_SECRET),
    });

    expect(replay.confirmation_code).toBe(first.confirmation_code);
    expect(
      await prisma.metaDeletionRequest.count({ where: { metaUserId: metaUser } })
    ).toBe(1);

    const row = await prisma.metaDeletionRequest.findUnique({
      where: { confirmationCode: first.confirmation_code },
    });
    await client.workflow.getHandle(`meta_deletion_${row!.id}`).result();

    const settled = await prisma.metaDeletionRequest.findUnique({
      where: { id: row!.id },
    });
    expect(settled!.status).toBe('COMPLETED');
    expect(settled!.attempts).toBe(1);
  }, 180000);

  it('two orchestrator instances cannot start competing reconcilers', async () => {
    // InfiniteWorkflowRegister starts this with a fixed workflow ID on every
    // boot, so a second instance (or a restart) must not create a second
    // execution.
    const startOnce = () =>
      client.workflow.start('metaDeletionReconcileWorkflow', {
        args: [],
        workflowId: 'meta-deletion-reconcile-workflow',
        taskQueue: TASK_QUEUE,
      });

    await startOnce();
    // The registrar swallows this rejection; the point is that Temporal
    // refuses rather than running a duplicate.
    await expect(startOnce()).rejects.toThrow();

    const executions: any[] = [];
    for await (const e of client.workflow.list({
      query: `WorkflowId = 'meta-deletion-reconcile-workflow'`,
    })) {
      executions.push(e);
    }
    const running = executions.filter(
      (e) => e.status?.name === 'RUNNING'
    );
    expect(running).toHaveLength(1);

    await client.workflow
      .getHandle('meta-deletion-reconcile-workflow')
      .terminate('test cleanup');
  }, 180000);
});
