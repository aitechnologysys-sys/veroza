import { Worker } from 'node:worker_threads';

/**
 * Kill the process if it never finishes starting.
 *
 * Background: on staging 2026-10-20 the orchestrator sat for eleven minutes
 * having printed nothing past its npm banner. pm2 reported it `online` with
 * zero restarts, the container healthcheck (which probes the frontend only)
 * reported healthy, and Temporal had no pollers, so every queued post stayed
 * in QUEUE. Process state at the time: one thread in `futex_wait_queue`, RSS
 * 80MB against a healthy ~1.37GB, and `cpu_ticks` frozen — it was blocked, not
 * slow. The backend hung the same way twice on the same day.
 *
 * The watchdog runs in a worker thread, and that is the whole point. A hang
 * during module evaluation blocks the main thread outright, so a `setTimeout`
 * on the main event loop would never fire — it cannot catch the failure this
 * exists for. A worker has its own loop and keeps counting.
 *
 * SIGKILL rather than SIGTERM for the same reason: signal handlers run on the
 * main thread, and a blocked main thread never runs them. SIGKILL is delivered
 * by the kernel regardless, the process manager sees a non-zero exit, and
 * restarts it. Every lone restart we have observed has succeeded.
 */
export const armStartupWatchdog = (
  service: string,
  timeoutMs = Number(process.env.STARTUP_TIMEOUT_MS ?? 240000)
): (() => void) => {
  // Opt out with STARTUP_TIMEOUT_MS=0, e.g. when debugging a slow boot.
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return () => undefined;
  }

  const worker = new Worker(
    `
    const { workerData } = require('node:worker_threads');
    setTimeout(() => {
      console.error(
        '[' + workerData.service + '] startup did not complete within ' +
        workerData.timeoutMs + 'ms — exiting so the process manager restarts it'
      );
      process.kill(workerData.pid, 'SIGKILL');
    }, workerData.timeoutMs);
    `,
    {
      eval: true,
      workerData: { service, timeoutMs, pid: process.pid },
    }
  );

  // Never let the watchdog itself be the reason the process stays alive.
  worker.unref();

  let disarmed = false;
  return () => {
    if (disarmed) {
      return;
    }
    disarmed = true;
    worker.terminate().catch(() => undefined);
  };
};
