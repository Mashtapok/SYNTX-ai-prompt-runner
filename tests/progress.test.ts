import { describe, expect, it } from "vitest";
import { getProgressView } from "../src/popup/progress";
import type { RunState } from "../src/shared/types";

describe("getProgressView", () => {
  it("uses generation skeleton duration for average when available", () => {
    const progress = getProgressView(
      {
        status: "waiting",
        mode: "full",
        currentIndex: 2,
        lastCompletedIndex: 1,
        totalScenes: 4,
        startedAt: 1000,
        pausedAt: null,
        elapsedActiveMs: 0,
        generationElapsedMs: 60000,
        generationCompletedCount: 2,
        errorMessage: null,
        batchId: "batch"
      } satisfies RunState,
      { intervalSec: 30 },
      121000
    );

    expect(progress.completed).toBe(2);
    expect(progress.averageMs).toBe(30000);
    expect(progress.remainingMs).toBe(60000);
  });
});
