import { describe, expect, it, vi } from "vitest";
import { formatScenePrompt, PromptRunner, type RunnerActions } from "../src/content/runner";
import { loadLogs, loadRunState, MemoryStorageArea, saveBatch, saveSettings } from "../src/shared/storage";
import type { StoredBatch } from "../src/shared/types";

describe("PromptRunner", () => {
  it("runs a full batch and records successful checkpoints", async () => {
    const area = new MemoryStorageArea();
    const submitted: string[] = [];
    const notifyWhenGenerationsComplete = vi.fn();
    await saveBatch(makeBatch(3), area);
    await saveSettings({ intervalSec: 1 }, area);

    const runner = new PromptRunner(area, {
      ...baseActions(),
      submitPrompt: (prompt) => {
        submitted.push(prompt);
      },
      notifyWhenGenerationsComplete,
      sleep: async () => "done"
    });

    await runner.start("full");

    await vi.waitFor(async () => {
      expect((await loadRunState(area)).status).toBe("completed");
    });

    expect(submitted).toEqual([
      "СЦЕНА 1 — ПРОМПТ:\nPrompt 1",
      "СЦЕНА 2 — ПРОМПТ:\nPrompt 2",
      "СЦЕНА 3 — ПРОМПТ:\nPrompt 3"
    ]);
    expect(await loadLogs(area)).toHaveLength(3);
    expect(await loadRunState(area)).toMatchObject({ lastCompletedIndex: 2, message: "Completed." });
    expect(notifyWhenGenerationsComplete).toHaveBeenCalledWith(3, expect.any(Function));
  });

  it("records success after the configured interval without waiting for skeleton completion", async () => {
    const area = new MemoryStorageArea();
    let intervalWaits = 0;
    await saveBatch(makeBatch(1), area);
    await saveSettings({ intervalSec: 1 }, area);

    const runner = new PromptRunner(area, {
      ...baseActions(),
      sleep: async () => {
        intervalWaits += 1;
        return "done";
      }
    });

    await runner.start("full");

    await vi.waitFor(async () => {
      expect((await loadRunState(area)).status).toBe("completed");
    });
    expect(intervalWaits).toBe(1);
    expect(await loadRunState(area)).toMatchObject({ generationElapsedMs: 0, generationCompletedCount: 0 });
  });

  it("runs two test scenes and continues from scene three when Start is pressed", async () => {
    const area = new MemoryStorageArea();
    const submitted: string[] = [];
    const stopGenerationTracking = vi.fn();
    const cancelGenerationIdleWait = vi.fn();
    await saveBatch(makeBatch(5), area);
    await saveSettings({ intervalSec: 1 }, area);

    const runner = new PromptRunner(area, {
      ...baseActions(),
      submitPrompt: (prompt) => {
        submitted.push(prompt);
      },
      stopGenerationTracking,
      cancelGenerationIdleWait,
      sleep: async () => "done"
    });

    await runner.start("test");

    await vi.waitFor(async () => {
      expect(await loadRunState(area)).toMatchObject({
        status: "completed",
        mode: "test",
        currentIndex: 2,
        lastCompletedIndex: 1
      });
    });
    expect(submitted).toEqual([
      "СЦЕНА 1 — ПРОМПТ:\nPrompt 1",
      "СЦЕНА 2 — ПРОМПТ:\nPrompt 2"
    ]);

    await runner.start("full");

    await vi.waitFor(async () => {
      expect(await loadRunState(area)).toMatchObject({
        status: "completed",
        mode: "full",
        currentIndex: 5,
        lastCompletedIndex: 4
      });
    });
    expect(submitted).toEqual([
      "СЦЕНА 1 — ПРОМПТ:\nPrompt 1",
      "СЦЕНА 2 — ПРОМПТ:\nPrompt 2",
      "СЦЕНА 3 — ПРОМПТ:\nPrompt 3",
      "СЦЕНА 4 — ПРОМПТ:\nPrompt 4",
      "СЦЕНА 5 — ПРОМПТ:\nPrompt 5"
    ]);
    expect((await loadLogs(area)).filter((entry) => entry.status === "Success")).toHaveLength(5);
    expect(stopGenerationTracking).toHaveBeenCalledTimes(1);
    expect(cancelGenerationIdleWait).toHaveBeenCalledTimes(1);
  });

  it("records skeleton duration separately for average", async () => {
    const area = new MemoryStorageArea();
    let onGenerationComplete: (durationMs: number) => void = () => undefined;
    const snapshot = {};
    await saveBatch(makeBatch(1), area);
    await saveSettings({ intervalSec: 1 }, area);

    const runner = new PromptRunner(area, {
      ...baseActions(),
      captureGenerationSnapshot: () => snapshot,
      trackGenerationFromSnapshot: (receivedSnapshot, _sceneNumber, onComplete) => {
        expect(receivedSnapshot).toBe(snapshot);
        onGenerationComplete = onComplete;
      },
      sleep: async () => {
        onGenerationComplete(42000);
        return "done";
      }
    });

    await runner.start("full");

    await vi.waitFor(async () => {
      expect((await loadRunState(area)).status).toBe("completed");
    });
    expect(await loadRunState(area)).toMatchObject({ generationElapsedMs: 42000, generationCompletedCount: 1 });
  });

  it("records that an image download was started", async () => {
    const area = new MemoryStorageArea();
    let onDownload: (result: { status: "started" }) => void = () => undefined;
    await saveBatch(makeBatch(1), area);
    await saveSettings({ intervalSec: 1 }, area);

    const runner = new PromptRunner(area, {
      ...baseActions(),
      trackGenerationFromSnapshot: (_snapshot, _sceneNumber, _onComplete, receivedOnDownload) => {
        onDownload = receivedOnDownload;
      },
      sleep: async () => {
        onDownload({ status: "started" });
        return "done";
      }
    });

    await runner.start("full");

    await vi.waitFor(async () => {
      expect(await loadLogs(area)).toMatchObject([
        { sceneNumber: 1, status: "Info", message: "Image download started." },
        { sceneNumber: 1, status: "Success" }
      ]);
    });
  });

  it("waits interval and retries the same scene after a 429 rate limit", async () => {
    const area = new MemoryStorageArea();
    let submitAttempts = 0;
    let intervalWaits = 0;
    let rateLimitChecks = 0;
    const stopAttemptTracking = vi.fn();
    const notifyRateLimit = vi.fn();
    await saveBatch(makeBatch(1), area);
    await saveSettings({ intervalSec: 1 }, area);

    const runner = new PromptRunner(area, {
      ...baseActions(),
      submitPrompt: () => {
        submitAttempts += 1;
      },
      takeRateLimitSignal: async () => {
        rateLimitChecks += 1;
        return rateLimitChecks === 1;
      },
      trackGenerationFromSnapshot: () => stopAttemptTracking,
      notifyRateLimit,
      sleep: async () => {
        intervalWaits += 1;
        return "done";
      }
    });

    await runner.start("full");

    await vi.waitFor(async () => {
      expect((await loadRunState(area)).status).toBe("completed");
    });

    expect(submitAttempts).toBe(2);
    expect(intervalWaits).toBe(2);
    expect(stopAttemptTracking).toHaveBeenCalledTimes(1);
    expect(notifyRateLimit).toHaveBeenCalledWith(1);
    expect(await loadLogs(area)).toMatchObject([
      { sceneNumber: 1, status: "Error", message: "429 rate limit. Retrying scene." },
      { sceneNumber: 1, status: "Success" }
    ]);
  });

  it("records a watched 429 before the interval finishes", async () => {
    const area = new MemoryStorageArea();
    let releaseInterval: (value: "done") => void = () => undefined;
    let intervalWaits = 0;
    let rateLimitWatches = 0;
    const notifyRateLimit = vi.fn();
    await saveBatch(makeBatch(1), area);
    await saveSettings({ intervalSec: 10 }, area);

    const runner = new PromptRunner(area, {
      ...baseActions(),
      watchRateLimitSignal: (_since, onDetected) => {
        rateLimitWatches += 1;

        if (rateLimitWatches === 1) {
          onDetected();
        }

        return () => undefined;
      },
      notifyRateLimit,
      sleep: () => {
        intervalWaits += 1;

        if (intervalWaits > 1) {
          return Promise.resolve("done");
        }

        return new Promise<"done">((resolve) => {
          releaseInterval = resolve;
        });
      }
    });

    await runner.start("full");

    await vi.waitFor(async () => {
      expect(await loadLogs(area)).toMatchObject([{ sceneNumber: 1, status: "Error" }]);
    });
    expect(notifyRateLimit).toHaveBeenCalledWith(1);
    expect((await loadRunState(area)).lastCompletedIndex).toBe(-1);

    releaseInterval("done");

    await vi.waitFor(async () => {
      expect((await loadRunState(area)).status).toBe("completed");
    });
  });

  it("formats the prompt with the scene header", () => {
    expect(formatScenePrompt({ index: 17, sceneNumber: 18, prompt: "Prompt body" })).toBe(
      "СЦЕНА 18 — ПРОМПТ:\nPrompt body"
    );
  });

  it("pauses after the current interval wait", async () => {
    const area = new MemoryStorageArea();
    let releaseInterval: (value: "done") => void = () => undefined;
    await saveBatch(makeBatch(2), area);
    await saveSettings({ intervalSec: 1 }, area);

    const runner = new PromptRunner(area, {
      ...baseActions(),
      sleep: () =>
        new Promise<"done">((resolve) => {
          releaseInterval = resolve;
        })
    });

    await runner.start("full");

    await vi.waitFor(async () => {
      expect((await loadRunState(area)).status).toBe("waiting");
    });

    await runner.pause();
    expect((await loadRunState(area)).status).toBe("waiting");
    releaseInterval("done");

    await vi.waitFor(async () => {
      expect((await loadRunState(area)).status).toBe("paused");
    });
    expect(await loadRunState(area)).toMatchObject({ lastCompletedIndex: 0, currentIndex: 1 });
  });

  it("reloads once after an error and then retries the same scene", async () => {
    const area = new MemoryStorageArea();
    let attempts = 0;
    let reloads = 0;
    await saveBatch(makeBatch(1), area);
    await saveSettings({ intervalSec: 1 }, area);

    const runner = new PromptRunner(area, {
      ...baseActions(),
      submitPrompt: () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("Prompt field not found.");
        }
      },
      reloadPage: () => {
        reloads += 1;
      }
    });

    await runner.start("full");

    await vi.waitFor(async () => {
      expect((await loadRunState(area)).status).toBe("retrying");
    });

    expect(reloads).toBe(1);
    await runner.resumeAfterReload();

    await vi.waitFor(async () => {
      expect((await loadRunState(area)).status).toBe("completed");
    });
    expect(attempts).toBe(2);
  });

  it("stops after the retry also fails", async () => {
    const area = new MemoryStorageArea();
    await saveBatch(makeBatch(1), area);
    await saveSettings({ intervalSec: 1 }, area);

    const runner = new PromptRunner(area, {
      ...baseActions(),
      submitPrompt: () => {
        throw new Error("Generate button not found.");
      }
    });

    await runner.start("full");

    await vi.waitFor(async () => {
      expect((await loadRunState(area)).status).toBe("retrying");
    });

    await runner.resumeAfterReload();

    await vi.waitFor(async () => {
      expect((await loadRunState(area)).status).toBe("error");
    });
    expect((await loadLogs(area))[0]).toMatchObject({ sceneNumber: 1, status: "Error" });
  });
});

function baseActions(): RunnerActions {
  return {
    now: () => Date.now(),
    validatePage: () => ({ ok: true, errors: [] }),
    submitPrompt: () => undefined,
    captureGenerationSnapshot: () => ({}),
    trackGenerationFromSnapshot: () => undefined,
    stopGenerationTracking: () => undefined,
    reloadPage: () => undefined,
    sleep: async () => "done"
  };
}

function makeBatch(count: number): StoredBatch {
  return {
    id: "batch",
    fileName: "scenes.txt",
    size: 1,
    lastModified: 1,
    sceneCount: count,
    scenes: Array.from({ length: count }, (_, index) => ({
      index,
      sceneNumber: index + 1,
      prompt: `Prompt ${index + 1}`
    }))
  };
}
