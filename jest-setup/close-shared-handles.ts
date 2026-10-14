/**
 * Closes process-wide handles that module imports open, so Jest can exit.
 *
 * `redis.service.ts` builds its client at import time:
 *
 *   export const ioRedis = process.env.REDIS_URL ? new Redis(...) : MockRedis
 *
 * Importing anything that reaches it — AnalyticsCacheService, and through it
 * MetaDeletionService, MetaController and MetaActivity — opens a socket as a
 * side effect of the import, with no owner to close it. The socket keeps the
 * event loop alive, so the run finishes its tests and then hangs;
 * `--detectOpenHandles` reports it as a TCPWRAP at redis.service.ts:26.
 *
 * A spec cannot close it itself, because it never opened it. This runs after
 * every file's tests and closes it.
 *
 * `--forceExit` would paper over this and would also hide a real leak added
 * later, so the handle is closed rather than the process killed.
 */
afterAll(async () => {
  let shared: any;
  try {
    // Resolves to the instance this file's module registry already holds.
    ({ ioRedis: shared } = require('@gitroom/nestjs-libraries/redis/redis.service'));
  } catch {
    // The suite never pulled Redis in; nothing was opened.
    return;
  }

  // The mock exposes no connection methods, and 'end' means already closed.
  if (!shared || shared.status === 'end') {
    return;
  }

  // quit() sends QUIT and waits for the server to acknowledge. That only works
  // on a live connection: the client is configured with
  // `maxRetriesPerRequest: null`, so when no Redis is listening it sits in
  // 'connecting' and the queued QUIT never resolves — awaiting it is itself a
  // hang. Only negotiate when the connection is actually up; otherwise drop
  // the socket, which is synchronous and always succeeds.
  if (shared.status !== 'ready' || typeof shared.quit !== 'function') {
    shared.disconnect?.();
    return;
  }

  try {
    await shared.quit();
  } catch {
    shared.disconnect?.();
  }
});
