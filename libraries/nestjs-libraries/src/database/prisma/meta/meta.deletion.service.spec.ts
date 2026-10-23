import { MetaDeletionService } from '@gitroom/nestjs-libraries/database/prisma/meta/meta.deletion.service';

type Row = {
  id: string;
  confirmationCode: string;
  metaApp: 'FACEBOOK' | 'INSTAGRAM' | 'THREADS';
  metaUserId: string;
  callbackType: 'DEAUTHORIZE' | 'DATA_DELETION';
  status: string;
  matchedCount: number;
  attempts: number;
  matchedTargets: string | null;
  createdAt: Date;
  completedAt: Date | null;
};

/** In-memory stand-in for MetaDeletionRepository. */
const makeDeletionRepo = (rows: Row[] = []) => {
  const store = [...rows];
  return {
    store,
    create: jest.fn(async (r: any) => {
      const row: Row = {
        id: `req-${store.length + 1}`,
        confirmationCode: r.confirmationCode,
        metaApp: r.metaApp,
        metaUserId: r.metaUserId,
        callbackType: r.callbackType,
        status: 'PENDING',
        matchedCount: 0,
        attempts: 0,
        matchedTargets: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        completedAt: null,
      };
      store.push(row);
      return row;
    }),
    findOpen: jest.fn(async (app: string, user: string, type: string) =>
      store.find(
        (r) =>
          r.metaApp === app &&
          r.metaUserId === user &&
          r.callbackType === type &&
          ['PENDING', 'PROCESSING'].includes(r.status)
      )
    ),
    findById: jest.fn(async (id: string) => store.find((r) => r.id === id)),
    findStranded: jest.fn(async (olderThan: Date) =>
      store.filter(
        (r) =>
          ['PENDING', 'PROCESSING'].includes(r.status) && r.createdAt < olderThan
      )
    ),
    findByConfirmationCode: jest.fn(async (code: string) =>
      store.find((r) => r.confirmationCode === code)
    ),
    claimForProcessing: jest.fn(async (id: string) => {
      const row = store.find((r) => r.id === id);
      // Mirrors the repository: open statuses are claimable so a retry can
      // resume; terminal ones are not.
      if (!row || !['PENDING', 'PROCESSING'].includes(row.status)) return false;
      row.status = 'PROCESSING';
      row.attempts += 1;
      return true;
    }),
    recordMatchedTargets: jest.fn(
      async (id: string, targets: { id: string }[]) => {
        const row = store.find((r) => r.id === id)!;
        row.matchedTargets = JSON.stringify(targets);
        row.matchedCount = targets.length;
        return row;
      }
    ),
    markCompleted: jest.fn(async (id: string, matched: number) => {
      const row = store.find((r) => r.id === id)!;
      row.status = matched > 0 ? 'COMPLETED' : 'UNMATCHED';
      row.matchedCount = matched;
      row.completedAt = new Date('2026-01-02T00:00:00Z');
      return row;
    }),
    markFailed: jest.fn(async (id: string) => {
      const row = store.find((r) => r.id === id)!;
      row.status = 'FAILED';
      return row;
    }),
  };
};

const makeIntegrationRepo = (integrations: any[] = []) => ({
  findMetaIntegrationsByUserId: jest.fn(
    async (providers: string[], metaUserId: string) =>
      integrations.filter(
        (i) =>
          providers.includes(i.providerIdentifier) &&
          i.rootInternalId === metaUserId
      )
  ),
  findMetaIntegrationsByIds: jest.fn(async (ids: string[]) =>
    integrations.filter((i) => ids.includes(i.id))
  ),
  scrubMetaIntegration: jest.fn(async () => undefined),
  getPostIdsForIntegration: jest.fn(async () => ['post-1']),
});

const makeAnalyticsCache = () => ({
  clearIntegrationAnalytics: jest.fn(async () => ({
    scanned: 1,
    deleted: 1,
    truncated: false,
  })),
});

const makeManager = (revokeToken?: jest.Mock) => ({
  getSocialIntegration: jest.fn(() => (revokeToken ? { revokeToken } : {})),
});

const temporal = { client: { getRawClient: () => undefined } } as any;

const build = (
  deletionRepo: any,
  integrationRepo: any,
  manager: any,
  analyticsCache: any = makeAnalyticsCache()
) =>
  new MetaDeletionService(
    deletionRepo as any,
    integrationRepo as any,
    manager as any,
    temporal,
    analyticsCache as any
  );

describe('MetaDeletionService', () => {
  // 6. Duplicate callbacks
  describe('accept', () => {
    it('creates one request with an unguessable confirmation code', async () => {
      const repo = makeDeletionRepo();
      const service = build(repo, makeIntegrationRepo(), makeManager());

      const { request, isNew } = await service.accept(
        'FACEBOOK',
        'fb-1',
        'DATA_DELETION'
      );

      expect(isNew).toBe(true);
      // 24 random bytes, base64url
      expect(request.confirmationCode.length).toBeGreaterThanOrEqual(32);
      expect(request.confirmationCode).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('issues a different code every time', async () => {
      const repo = makeDeletionRepo();
      const service = build(repo, makeIntegrationRepo(), makeManager());

      const a = await service.accept('FACEBOOK', 'a', 'DATA_DELETION');
      const b = await service.accept('FACEBOOK', 'b', 'DATA_DELETION');

      expect(a.request.confirmationCode).not.toBe(b.request.confirmationCode);
    });

    it('returns the in-flight request when Meta replays a callback', async () => {
      const repo = makeDeletionRepo();
      const service = build(repo, makeIntegrationRepo(), makeManager());

      const first = await service.accept('FACEBOOK', 'fb-1', 'DATA_DELETION');
      const replay = await service.accept('FACEBOOK', 'fb-1', 'DATA_DELETION');

      expect(replay.isNew).toBe(false);
      expect(replay.request.id).toBe(first.request.id);
      expect(repo.create).toHaveBeenCalledTimes(1);
    });

    it('treats the same id under a different app as a different identity', async () => {
      const repo = makeDeletionRepo();
      const service = build(repo, makeIntegrationRepo(), makeManager());

      await service.accept('FACEBOOK', 'same-id', 'DATA_DELETION');
      const other = await service.accept('THREADS', 'same-id', 'DATA_DELETION');

      expect(other.isNew).toBe(true);
      expect(repo.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('process', () => {
    // 7. Successful deletion
    it('scrubs every matched integration and completes', async () => {
      const repo = makeDeletionRepo();
      const integrations = makeIntegrationRepo([
        {
          id: 'i1',
          providerIdentifier: 'facebook',
          rootInternalId: 'fb-1',
          token: 't1',
        },
        {
          id: 'i2',
          providerIdentifier: 'instagram',
          rootInternalId: 'fb-1',
          token: 't2',
        },
      ]);
      const service = build(repo, integrations, makeManager());
      const { request } = await service.accept(
        'FACEBOOK',
        'fb-1',
        'DATA_DELETION'
      );

      const result = await service.process(request.id);

      expect(result).toEqual({ matched: 2, status: 'COMPLETED' });
      expect(integrations.scrubMetaIntegration).toHaveBeenCalledTimes(2);
      expect(repo.store[0].status).toBe('COMPLETED');
    });

    it('clears the analytics cache for the matched integration only', async () => {
      const repo = makeDeletionRepo();
      const integrations = makeIntegrationRepo([
        {
          id: 'target',
          providerIdentifier: 'facebook',
          rootInternalId: 'fb-1',
          organizationId: 'org-a',
          token: 't',
        },
        {
          id: 'other-tenant',
          providerIdentifier: 'facebook',
          rootInternalId: 'fb-2',
          organizationId: 'org-b',
          token: 't',
        },
      ]);
      const cache = makeAnalyticsCache();
      const service = build(repo, integrations, makeManager(), cache);
      const { request } = await service.accept(
        'FACEBOOK',
        'fb-1',
        'DATA_DELETION'
      );

      await service.process(request.id);

      // Scoped to the owning organization and integration, with the post keys
      // the cache also writes under.
      expect(cache.clearIntegrationAnalytics).toHaveBeenCalledTimes(1);
      expect(cache.clearIntegrationAnalytics).toHaveBeenCalledWith(
        'org-a',
        'target',
        ['post-1']
      );
    });

    it('refuses to complete when the cache cleanup throws', async () => {
      const repo = makeDeletionRepo();
      const integrations = makeIntegrationRepo([
        {
          id: 'i1',
          providerIdentifier: 'facebook',
          rootInternalId: 'fb-1',
          organizationId: 'org-a',
          token: 't',
        },
      ]);
      const cache = makeAnalyticsCache();
      cache.clearIntegrationAnalytics = jest.fn(async () => {
        throw new Error('redis down');
      });
      const service = build(repo, integrations, makeManager(), cache);
      const { request } = await service.accept(
        'FACEBOOK',
        'fb-1',
        'DATA_DELETION'
      );

      // The row is scrubbed, but cached Meta data may remain, so the request
      // must not be reported as done.
      await expect(service.process(request.id)).rejects.toThrow(
        'Analytics cache cleanup was incomplete'
      );

      expect(integrations.scrubMetaIntegration).toHaveBeenCalledWith('i1');
      expect(repo.store[0].status).toBe('PROCESSING');
      expect(repo.store[0].status).not.toBe('COMPLETED');
    });

    it('refuses to complete when the SCAN is truncated', async () => {
      const repo = makeDeletionRepo();
      const integrations = makeIntegrationRepo([
        {
          id: 'i1',
          providerIdentifier: 'facebook',
          rootInternalId: 'fb-1',
          organizationId: 'org-a',
          token: 't',
        },
      ]);
      const cache = makeAnalyticsCache();
      // A keyspace big enough to exhaust the iteration cap.
      cache.clearIntegrationAnalytics = jest.fn(async () => ({
        scanned: 100000,
        deleted: 99000,
        truncated: true,
      }));
      const service = build(repo, integrations, makeManager(), cache);
      const { request } = await service.accept(
        'FACEBOOK',
        'fb-1',
        'DATA_DELETION'
      );

      await expect(service.process(request.id)).rejects.toThrow(
        'Analytics cache cleanup was incomplete'
      );
      expect(repo.store[0].status).not.toBe('COMPLETED');
    });

    it('a retry resumes an interrupted request and completes it', async () => {
      const repo = makeDeletionRepo();
      const integrations = makeIntegrationRepo([
        {
          id: 'i1',
          providerIdentifier: 'facebook',
          rootInternalId: 'fb-1',
          organizationId: 'org-a',
          token: 't',
        },
      ]);
      const cache = makeAnalyticsCache();
      cache.clearIntegrationAnalytics = jest
        .fn()
        .mockRejectedValueOnce(new Error('redis down'))
        .mockResolvedValue({ scanned: 1, deleted: 1, truncated: false });
      const service = build(repo, integrations, makeManager(), cache);
      const { request } = await service.accept(
        'FACEBOOK',
        'fb-1',
        'DATA_DELETION'
      );

      await expect(service.process(request.id)).rejects.toThrow();
      // Temporal retries the activity; the request must be re-claimable.
      const result = await service.process(request.id);

      expect(result).toEqual({ matched: 1, status: 'COMPLETED' });
      expect(repo.store[0].status).toBe('COMPLETED');
      expect(repo.store[0].attempts).toBeGreaterThanOrEqual(2);
    });

    // 4. Unknown user id
    it('marks an unmatched id as UNMATCHED and deletes nothing', async () => {
      const repo = makeDeletionRepo();
      const integrations = makeIntegrationRepo([
        {
          id: 'i1',
          providerIdentifier: 'facebook',
          rootInternalId: 'someone-else',
          token: 't',
        },
      ]);
      const service = build(repo, integrations, makeManager());
      const { request } = await service.accept(
        'FACEBOOK',
        'unknown-user',
        'DATA_DELETION'
      );

      const result = await service.process(request.id);

      expect(result).toEqual({ matched: 0, status: 'UNMATCHED' });
      expect(integrations.scrubMetaIntegration).not.toHaveBeenCalled();
      expect(repo.store[0].status).toBe('UNMATCHED');
    });

    // 11. No deletion of unrelated integrations
    // 5. Multi-tenant identity isolation
    it('never touches other providers, other identities or other tenants', async () => {
      const repo = makeDeletionRepo();
      const integrations = makeIntegrationRepo([
        // target
        {
          id: 'target',
          providerIdentifier: 'facebook',
          rootInternalId: 'fb-1',
          organizationId: 'org-a',
          token: 't',
        },
        // same id, different Meta app — not the same person
        {
          id: 'threads-same-id',
          providerIdentifier: 'threads',
          rootInternalId: 'fb-1',
          organizationId: 'org-a',
          token: 't',
        },
        // same app, different person
        {
          id: 'other-user',
          providerIdentifier: 'facebook',
          rootInternalId: 'fb-2',
          organizationId: 'org-a',
          token: 't',
        },
        // unrelated platform entirely
        {
          id: 'mastodon',
          providerIdentifier: 'mastodon',
          rootInternalId: 'fb-1',
          organizationId: 'org-b',
          token: 't',
        },
      ]);
      const service = build(repo, integrations, makeManager());
      const { request } = await service.accept(
        'FACEBOOK',
        'fb-1',
        'DEAUTHORIZE'
      );

      await service.process(request.id);

      const scrubbed = integrations.scrubMetaIntegration.mock.calls.map(
        (c: any[]) => c[0]
      );
      expect(scrubbed).toEqual(['target']);
    });

    // 8. Failed upstream revocation
    it('still scrubs when upstream revocation throws', async () => {
      const revokeToken = jest.fn(async () => {
        throw new Error('Meta returned 400');
      });
      const repo = makeDeletionRepo();
      const integrations = makeIntegrationRepo([
        {
          id: 'i1',
          providerIdentifier: 'facebook',
          rootInternalId: 'fb-1',
          token: 't1',
        },
      ]);
      const service = build(repo, integrations, makeManager(revokeToken));
      const { request } = await service.accept(
        'FACEBOOK',
        'fb-1',
        'DATA_DELETION'
      );

      const result = await service.process(request.id);

      expect(revokeToken).toHaveBeenCalled();
      expect(integrations.scrubMetaIntegration).toHaveBeenCalledWith('i1');
      expect(result.matched).toBe(1);
      expect(repo.store[0].status).toBe('COMPLETED');
    });

    // Idempotency of the worker itself
    it('does not delete twice when the activity is retried', async () => {
      const repo = makeDeletionRepo();
      const integrations = makeIntegrationRepo([
        {
          id: 'i1',
          providerIdentifier: 'facebook',
          rootInternalId: 'fb-1',
          token: 't1',
        },
      ]);
      const service = build(repo, integrations, makeManager());
      const { request } = await service.accept(
        'FACEBOOK',
        'fb-1',
        'DATA_DELETION'
      );

      await service.process(request.id);
      await service.process(request.id);

      expect(integrations.scrubMetaIntegration).toHaveBeenCalledTimes(1);
    });
  });

  describe('reconcile', () => {
    const buildWithEnqueue = (repo: any, integrations: any) => {
      const service = build(repo, integrations, makeManager());
      const enqueued: string[] = [];
      (service as any).enqueue = async (id: string) => {
        enqueued.push(id);
      };
      return { service, enqueued };
    };

    it('re-drives a request whose workflow never started', async () => {
      const repo = makeDeletionRepo();
      const { service, enqueued } = buildWithEnqueue(
        repo,
        makeIntegrationRepo()
      );
      const { request } = await service.accept(
        'FACEBOOK',
        'fb-1',
        'DATA_DELETION'
      );
      // Older than the grace period — the fake stamps a fixed 2026 date.
      const result = await service.reconcile(10);

      expect(result.restarted).toContain(request.id);
      expect(enqueued).toContain(request.id);
    });

    it('leaves recently accepted requests alone', async () => {
      const repo = makeDeletionRepo();
      const { service, enqueued } = buildWithEnqueue(
        repo,
        makeIntegrationRepo()
      );
      await service.accept('FACEBOOK', 'fb-1', 'DATA_DELETION');
      // The fake's createdAt is in the past, so a grace period reaching far
      // enough back excludes it.
      repo.store[0].createdAt = new Date();

      const result = await service.reconcile(10);

      expect(result.restarted).toEqual([]);
      expect(enqueued).toEqual([]);
    });

    it('never re-drives a settled request', async () => {
      const repo = makeDeletionRepo();
      const integrations = makeIntegrationRepo([
        {
          id: 'i1',
          providerIdentifier: 'facebook',
          rootInternalId: 'fb-1',
          organizationId: 'org-a',
          token: 't',
        },
      ]);
      const { service, enqueued } = buildWithEnqueue(repo, integrations);
      const { request } = await service.accept(
        'FACEBOOK',
        'fb-1',
        'DATA_DELETION'
      );
      await service.process(request.id);

      const result = await service.reconcile(10);

      expect(result.restarted).toEqual([]);
      expect(enqueued).toEqual([]);
    });

    it('flags a request open beyond the processing window', async () => {
      const repo = makeDeletionRepo();
      const { service } = buildWithEnqueue(repo, makeIntegrationRepo());
      const { request } = await service.accept(
        'FACEBOOK',
        'fb-1',
        'DATA_DELETION'
      );
      repo.store[0].createdAt = new Date(Date.now() - 48 * 60 * 60 * 1000);

      const result = await service.reconcile(10, 24);

      expect(result.stalled).toContain(request.id);
    });

    it('keeps going when one enqueue fails', async () => {
      const repo = makeDeletionRepo();
      const service = build(repo, makeIntegrationRepo(), makeManager());
      await service.accept('FACEBOOK', 'fb-1', 'DATA_DELETION');
      await service.accept('FACEBOOK', 'fb-2', 'DATA_DELETION');
      let calls = 0;
      (service as any).enqueue = async () => {
        calls += 1;
        if (calls === 1) throw new Error('temporal unavailable');
      };

      const result = await service.reconcile(10);

      // The second one still gets re-driven.
      expect(result.restarted).toHaveLength(1);
      expect(calls).toBe(2);
    });
  });

  // 10. Public deletion-status response
  describe('publicStatus', () => {
    it('reports an unknown code without confirming anything', async () => {
      const service = build(
        makeDeletionRepo(),
        makeIntegrationRepo(),
        makeManager()
      );

      await expect(service.publicStatus('nope')).resolves.toEqual({
        confirmationCode: 'nope',
        status: 'not_found',
        receivedAt: null,
        completedAt: null,
      });
    });

    it('reports pending, then completed', async () => {
      const repo = makeDeletionRepo();
      const integrations = makeIntegrationRepo([
        {
          id: 'i1',
          providerIdentifier: 'facebook',
          rootInternalId: 'fb-1',
          token: 't',
        },
      ]);
      const service = build(repo, integrations, makeManager());
      const { request } = await service.accept(
        'FACEBOOK',
        'fb-1',
        'DATA_DELETION'
      );

      expect((await service.publicStatus(request.confirmationCode)).status).toBe(
        'pending'
      );

      await service.process(request.id);

      expect((await service.publicStatus(request.confirmationCode)).status).toBe(
        'completed'
      );
    });

    it('shows UNMATCHED as completed and leaks nothing about the identity', async () => {
      const repo = makeDeletionRepo();
      const service = build(repo, makeIntegrationRepo(), makeManager());
      const { request } = await service.accept(
        'FACEBOOK',
        'ghost',
        'DATA_DELETION'
      );
      await service.process(request.id);

      const status = await service.publicStatus(request.confirmationCode);

      expect(status.status).toBe('completed');
      // The public shape must never carry the identity or internals.
      expect(Object.keys(status).sort()).toEqual([
        'completedAt',
        'confirmationCode',
        'receivedAt',
        'status',
      ]);
      expect(JSON.stringify(status)).not.toContain('ghost');
    });

    it('does not expose the operator-facing failure reason', async () => {
      const repo = makeDeletionRepo();
      const service = build(repo, makeIntegrationRepo(), makeManager());
      const { request } = await service.accept(
        'FACEBOOK',
        'fb-1',
        'DATA_DELETION'
      );
      await service.markFailed(request.id, 'database exploded at host db-7');

      const status = await service.publicStatus(request.confirmationCode);

      expect(status.status).toBe('failed');
      expect(JSON.stringify(status)).not.toContain('db-7');
    });
  });
});
