import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { logger } from "@/lib/log";
import type { CronTickSummary } from "./cronTick";

/**
 * scheduleCronTick is the background half of GET /api/cron/tick: the
 * route hands it Next's after() so the tick runs once the acceptance
 * response has been sent. These tests inject a capturing scheduler
 * and fake runners, so no database or sending work is involved; they
 * prove the runner only runs when the scheduled task fires, and that
 * a failing runner is caught and logged instead of rejecting.
 */

type ScheduleFn = (task: () => Promise<void>) => void;
let scheduleCronTick: (
  schedule: ScheduleFn,
  runTick?: () => Promise<CronTickSummary>,
) => void;

beforeAll(async () => {
  process.env.DATABASE_URL = "file:./test-cron-tick-unit.db";
  const mod = await import("./cronTick");
  scheduleCronTick = mod.scheduleCronTick as never;
});

afterAll(() => {
  delete process.env.DATABASE_URL;
});

function emptySummary(): CronTickSummary {
  return {
    sends: {
      processed: 0,
      sent: 0,
      simulated: 0,
      completed: 0,
      skippedSuppressed: 0,
      deferredNoCapacity: 0,
      deferredOutsideWindow: 0,
      deferredHourlyCap: 0,
      deferredTickPacing: 0,
      failed: 0,
      quotaBlocked: 0,
      sync: [],
      webhooks: { attempted: 0, delivered: 0, failed: 0, retrying: 0 },
    },
    syncedAccounts: 0,
    repliesImported: 0,
    syncErrors: 0,
  };
}

describe("scheduleCronTick", () => {
  it("defers the runner until the scheduled task fires, then invokes it once", async () => {
    const tasks: Array<() => Promise<void>> = [];
    const runTick = vi.fn(async () => emptySummary());

    scheduleCronTick((task) => tasks.push(task), runTick);

    expect(tasks).toHaveLength(1);
    expect(runTick).not.toHaveBeenCalled();

    await tasks[0]();
    expect(runTick).toHaveBeenCalledTimes(1);
  });

  it("catches a failing runner and logs it instead of rejecting", async () => {
    const tasks: Array<() => Promise<void>> = [];
    const failure = new Error("tick exploded");
    const runTick = vi.fn(async () => {
      throw failure;
    });
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

    try {
      scheduleCronTick((task) => tasks.push(task), runTick);
      await expect(tasks[0]()).resolves.toBeUndefined();
      expect(runTick).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith("Cron tick failed", { error: failure });
    } finally {
      errorSpy.mockRestore();
    }
  });
});
