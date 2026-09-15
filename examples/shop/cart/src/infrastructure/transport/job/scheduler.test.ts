import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Job, schedule } from "./scheduler.ts";

describe("schedule", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs a job on its interval, keeps going past a failure, and stops when told", async () => {
    let runs = 0;
    const job: Job = {
      name: "tick",
      everyMs: 1_000,
      run: async () => {
        runs += 1;
        if (runs === 1) throw new Error("boom");
      },
    };
    const failed = vi.fn();
    const stop = schedule([job], failed);

    await vi.advanceTimersByTimeAsync(999);
    expect(runs).toBe(0);
    await vi.advanceTimersByTimeAsync(2_001);
    expect(runs).toBe(3);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledWith(job, expect.any(Error));

    stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(runs).toBe(3);
  });
});
