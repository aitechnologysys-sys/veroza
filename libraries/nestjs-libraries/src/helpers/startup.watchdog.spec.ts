/**
 * Tests for the startup watchdog.
 *
 * The behaviour under test is deliberately awkward to verify: the watchdog's
 * whole job is to SIGKILL the process it lives in. Asserting that in-process
 * would kill the test runner, so the kill path is exercised in a real child
 * process against the compiled helper, and the wiring is checked against a
 * mocked worker.
 *
 * Why a worker thread at all: the hang this exists for blocks the main thread
 * (staging 2026-10-20, orchestrator stuck 11 minutes with frozen cpu_ticks and
 * one thread in futex_wait_queue). A main-loop setTimeout cannot fire while the
 * main thread is blocked, so it would never have caught it.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const mockWorkerInstance = {
  unref: jest.fn(),
  terminate: jest.fn(async () => 0),
};
const MockWorker = jest.fn(() => mockWorkerInstance);

jest.mock('node:worker_threads', () => ({
  Worker: function (...args: any[]) {
    return (MockWorker as any)(...args);
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  armStartupWatchdog,
} = require('@gitroom/nestjs-libraries/helpers/startup.watchdog');

describe('armStartupWatchdog — wiring', () => {
  beforeEach(() => {
    MockWorker.mockClear();
    mockWorkerInstance.unref.mockClear();
    mockWorkerInstance.terminate.mockClear();
  });

  it('starts a worker carrying this process id and the timeout', () => {
    armStartupWatchdog('orchestrator', 1234);

    expect(MockWorker).toHaveBeenCalledTimes(1);
    const [source, options] = MockWorker.mock.calls[0] as any[];

    expect(options.eval).toBe(true);
    expect(options.workerData).toEqual({
      service: 'orchestrator',
      timeoutMs: 1234,
      pid: process.pid,
    });
    // SIGKILL, because a blocked main thread never runs signal handlers.
    expect(source).toContain('SIGKILL');
  });

  it('never keeps the process alive on its own account', () => {
    armStartupWatchdog('backend', 1000);

    expect(mockWorkerInstance.unref).toHaveBeenCalledTimes(1);
  });

  it('disarming terminates the worker', () => {
    const disarm = armStartupWatchdog('backend', 1000);

    expect(mockWorkerInstance.terminate).not.toHaveBeenCalled();
    disarm();
    expect(mockWorkerInstance.terminate).toHaveBeenCalledTimes(1);
  });

  it('is safe to disarm more than once', () => {
    const disarm = armStartupWatchdog('backend', 1000);

    disarm();
    disarm();
    disarm();

    expect(mockWorkerInstance.terminate).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1, NaN])(
    'does nothing when the timeout is %s, so a slow boot can be debugged',
    (timeout) => {
      const disarm = armStartupWatchdog('backend', timeout as number);

      expect(MockWorker).not.toHaveBeenCalled();
      expect(() => disarm()).not.toThrow();
    }
  );

  it('reads STARTUP_TIMEOUT_MS when no timeout is given', () => {
    const previous = process.env.STARTUP_TIMEOUT_MS;
    process.env.STARTUP_TIMEOUT_MS = '4321';
    try {
      armStartupWatchdog('backend');
      const [, options] = MockWorker.mock.calls[0] as any[];
      expect(options.workerData.timeoutMs).toBe(4321);
    } finally {
      process.env.STARTUP_TIMEOUT_MS = previous;
    }
  });
});

/**
 * The real thing. Runs the compiled helper in a child process and asserts the
 * child is actually killed — the one assertion that proves the watchdog works
 * rather than merely being wired up.
 */
describe('armStartupWatchdog — kills a real process', () => {
  const compiled = path.resolve(
    __dirname,
    '../../../../apps/backend/dist/libraries/nestjs-libraries/src/helpers/startup.watchdog.js'
  );

  const run = (script: string) =>
    spawnSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      timeout: 20000,
    });

  // Skipped rather than failed when the build output is absent, so the suite
  // does not depend on build ordering.
  const maybe = existsSync(compiled) ? it : it.skip;

  maybe('kills the process when startup never completes', () => {
    const result = run(`
      const { armStartupWatchdog } = require(${JSON.stringify(compiled)});
      armStartupWatchdog('test-service', 400);
      setInterval(() => {}, 1000); // stay alive, never disarm
    `);

    expect(result.signal).toBe('SIGKILL');
  });

  maybe('leaves the process alone once disarmed', () => {
    const result = run(`
      const { armStartupWatchdog } = require(${JSON.stringify(compiled)});
      const disarm = armStartupWatchdog('test-service', 400);
      disarm();
      setTimeout(() => process.exit(0), 1500);
    `);

    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
  });

  maybe('does not delay a process that finishes promptly', () => {
    const started = Date.now();
    const result = run(`
      const { armStartupWatchdog } = require(${JSON.stringify(compiled)});
      const disarm = armStartupWatchdog('test-service', 10000);
      disarm();
      process.exit(0);
    `);

    expect(result.status).toBe(0);
    // The unref'd worker must not hold the process open for the full timeout.
    expect(Date.now() - started).toBeLessThan(8000);
  });
});
