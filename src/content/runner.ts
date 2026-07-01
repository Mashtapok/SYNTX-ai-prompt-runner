import { TEST_SCENE_LIMIT } from "../shared/constants";
import { HumanError, toHumanMessage } from "../shared/errors";
import { logScene } from "../shared/logger";
import {
  clearLogs,
  loadBatch,
  loadRunState,
  loadSettings,
  saveRunState,
  type StorageAreaLike
} from "../shared/storage";
import { createActiveState, createIdleState, freezeRuntime, resumeRuntime } from "../shared/state";
import type { ImageDownloadResult, PageValidation, RunMode, RunState, Scene, StoredBatch } from "../shared/types";

export interface RunnerActions {
  now(): number;
  validatePage(): PageValidation;
  clearRateLimitSignal?(): Promise<void>;
  takeRateLimitSignal?(since?: number): Promise<boolean>;
  watchRateLimitSignal?(since: number, onDetected: () => void): () => void;
  submitPrompt(prompt: string): void | Promise<void>;
  captureGenerationSnapshot?(): unknown;
  trackGenerationFromSnapshot?(
    snapshot: unknown,
    sceneNumber: number,
    onComplete: (durationMs: number) => void,
    onDownload: (result: ImageDownloadResult) => void,
    shouldStop: () => boolean
  ): (() => void) | void;
  stopGenerationTracking?(): void;
  cancelGenerationIdleWait?(): void;
  notifyRateLimit?(sceneNumber: number): void | Promise<void>;
  notifyWhenGenerationsComplete?(sceneCount: number, shouldStop: () => boolean): void;
  reloadPage(): void;
  sleep(ms: number, shouldStop: () => boolean): Promise<"done" | "stopped">;
}

export class PromptRunner {
  private running = false;
  private pauseRequested = false;
  private stopRequested = false;
  private logQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly area: StorageAreaLike,
    private readonly actions: RunnerActions
  ) {}

  async getStatus(): Promise<RunState> {
    return loadRunState(this.area);
  }

  async validatePage(): Promise<PageValidation> {
    return this.actions.validatePage();
  }

  async start(mode: RunMode): Promise<RunState> {
    if (this.running) {
      return loadRunState(this.area);
    }

    const batch = await requireBatch(this.area);
    const validation = this.actions.validatePage();

    if (!validation.ok) {
      return this.failBeforeStart(validation.errors[0] ?? "Unable to continue.", batch);
    }

    const storedState = await loadRunState(this.area);

    if (mode === "full" && isCompletedTestForBatch(storedState, batch)) {
      const nextIndex = Math.min(batch.sceneCount, storedState.lastCompletedIndex + 1);

      if (nextIndex >= batch.sceneCount) {
        const completed = {
          ...storedState,
          mode: "full" as const,
          currentIndex: batch.sceneCount,
          message: "Completed."
        };
        await saveRunState(completed, this.area);
        return completed;
      }

      this.actions.cancelGenerationIdleWait?.();
      const continued = resumeRuntime(
        {
          ...storedState,
          status: "running",
          mode: "full",
          currentIndex: nextIndex,
          totalScenes: batch.sceneCount,
          errorMessage: null,
          pendingRetry: undefined,
          message: null
        },
        this.actions.now()
      );
      await saveRunState(continued, this.area);
      this.runFromState(continued).catch(() => undefined);
      return continued;
    }

    this.actions.stopGenerationTracking?.();
    await clearLogs(this.area);
    const state = createActiveState(batch, mode, 0, this.actions.now());
    await saveRunState(state, this.area);

    this.runFromState(state).catch(() => undefined);
    return state;
  }

  async resume(): Promise<RunState> {
    if (this.running) {
      return loadRunState(this.area);
    }

    const batch = await requireBatch(this.area);
    const validation = this.actions.validatePage();

    if (!validation.ok) {
      return this.failBeforeStart(validation.errors[0] ?? "Unable to continue.", batch);
    }

    const storedState = await loadRunState(this.area);
    const nextIndex = Math.min(batch.sceneCount, Math.max(0, storedState.lastCompletedIndex + 1));

    if (nextIndex >= batch.sceneCount) {
      const completed = {
        ...storedState,
        status: "completed" as const,
        currentIndex: batch.sceneCount,
        totalScenes: batch.sceneCount,
        message: "Completed."
      };
      await saveRunState(completed, this.area);
      return completed;
    }

    const resumed = resumeRuntime(
      {
        ...storedState,
        status: "running",
        mode: "full",
        currentIndex: nextIndex,
        totalScenes: batch.sceneCount,
        batchId: batch.id,
        errorMessage: null,
        pendingRetry: undefined,
        message: null
      },
      this.actions.now()
    );
    await saveRunState(resumed, this.area);
    this.runFromState(resumed).catch(() => undefined);
    return resumed;
  }

  async pause(): Promise<RunState> {
    this.pauseRequested = true;
    const state = await loadRunState(this.area);
    const nextState = {
      ...state,
      message: state.status === "waiting" || state.status === "running" ? "Pause requested." : state.message
    };
    await saveRunState(nextState, this.area);
    return nextState;
  }

  async stop(): Promise<RunState> {
    this.stopRequested = true;
    this.actions.stopGenerationTracking?.();
    const state = freezeRuntime(await loadRunState(this.area), this.actions.now());
    const stopped = {
      ...state,
      status: "stopped" as const,
      pausedAt: null,
      errorMessage: null,
      message: "Stopped."
    };
    await saveRunState(stopped, this.area);
    return stopped;
  }

  async resumeAfterReload(): Promise<RunState> {
    const state = await loadRunState(this.area);

    if (state.status === "retrying" && state.pendingRetry) {
      const resumed = resumeRuntime(state, this.actions.now());
      await saveRunState(resumed, this.area);
      this.runFromState(resumed).catch(() => undefined);
      return resumed;
    }

    if (state.status === "running" || state.status === "waiting") {
      const paused = {
        ...freezeRuntime(state, this.actions.now()),
        status: "paused" as const,
        pausedAt: this.actions.now(),
        message: "Ready to resume."
      };
      await saveRunState(paused, this.area);
      return paused;
    }

    return state;
  }

  private async runFromState(initialState: RunState): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    this.stopRequested = false;
    this.pauseRequested = false;
    let state = initialState;

    try {
      const batch = await requireBatch(this.area);
      const settings = await loadSettings(this.area);
      const maxExclusive = getMaxExclusive(batch, initialState.mode);
      let index = state.pendingRetry?.sceneIndex ?? state.currentIndex;

      while (index < maxExclusive) {
        if (this.stopRequested) {
          await this.stop();
          return;
        }

        const scene = batch.scenes[index];

        if (!scene) {
          await this.complete(state, initialState.mode === "test");
          return;
        }

        state = {
          ...state,
          status: "running",
          currentIndex: index,
          totalScenes: batch.sceneCount,
          errorMessage: null,
          message: null
        };
        await saveRunState(state, this.area);

        try {
          await this.actions.clearRateLimitSignal?.();
          const generationSnapshot = this.actions.captureGenerationSnapshot?.();
          const submittedAt = this.actions.now();
          await this.actions.submitPrompt(formatScenePrompt(scene));
          const stopAttemptTracking =
            generationSnapshot === undefined
              ? undefined
              : this.actions.trackGenerationFromSnapshot?.(
                  generationSnapshot,
                  scene.sceneNumber,
                  (durationMs) => {
                    state = {
                      ...state,
                      generationElapsedMs: (state.generationElapsedMs ?? 0) + durationMs,
                      generationCompletedCount: (state.generationCompletedCount ?? 0) + 1
                    };
                    void this.saveGenerationStats(durationMs);
                  },
                  (result) => void this.logDownloadResult(scene.sceneNumber, result),
                  () => this.stopRequested
                );
          let rateLimited = false;
          let rateLimitReport = Promise.resolve();
          const reportRateLimit = (): void => {
            if (rateLimited) {
              return;
            }

            rateLimited = true;
            stopAttemptTracking?.();
            const message = "429 rate limit. Retrying scene.";
            state = {
              ...state,
              status: "waiting",
              currentIndex: index,
              errorMessage: null,
              message
            };
            rateLimitReport = this.reportRateLimit(state, scene.sceneNumber, message);
          };
          state = {
            ...state,
            status: "waiting",
            message: `Waiting ${settings.intervalSec} sec.`
          };
          await saveRunState(state, this.area);

          const stopRateLimitWatch = this.actions.watchRateLimitSignal?.(submittedAt, reportRateLimit);
          const waitResult = await this.actions.sleep(settings.intervalSec * 1000, () => this.stopRequested);
          stopRateLimitWatch?.();

          if (waitResult === "stopped") {
            await this.stop();
            return;
          }

          if (!rateLimited && (await this.actions.takeRateLimitSignal?.(submittedAt))) {
            reportRateLimit();
          }

          await rateLimitReport;

          if (rateLimited) {
            if (this.pauseRequested) {
              await this.pauseNow(state);
              return;
            }

            continue;
          }
        } catch (error) {
          await this.handleSceneError(state, scene.sceneNumber, index, toHumanMessage(error));
          return;
        }

        state = {
          ...state,
          lastCompletedIndex: index,
          currentIndex: index + 1,
          pendingRetry: undefined
        };
        await saveRunState(state, this.area);
        await this.writeLog(scene.sceneNumber, "Success");

        if (index + 1 >= maxExclusive) {
          await this.complete(state, initialState.mode === "test");
          return;
        }

        if (this.pauseRequested) {
          await this.pauseNow(state);
          return;
        }

        index += 1;
      }

      await this.complete(state, initialState.mode === "test");
    } finally {
      this.running = false;
    }
  }

  private async saveGenerationStats(durationMs: number): Promise<void> {
    const current = await loadRunState(this.area);
    await saveRunState(
      {
        ...current,
        generationElapsedMs: (current.generationElapsedMs ?? 0) + durationMs,
        generationCompletedCount: (current.generationCompletedCount ?? 0) + 1
      },
      this.area
    );
  }

  private logDownloadResult(sceneNumber: number, result: ImageDownloadResult): Promise<void> {
    return result.status === "started"
      ? this.writeLog(sceneNumber, "Info", "Image download started.")
      : this.writeLog(sceneNumber, "Error", result.message);
  }

  private writeLog(
    sceneNumber: number | null,
    status: "Success" | "Error" | "Info",
    message?: string
  ): Promise<void> {
    const write = this.logQueue.then(() => logScene(this.area, sceneNumber, status, message));
    this.logQueue = write.catch(() => undefined);
    return write;
  }

  private async reportRateLimit(
    state: RunState,
    sceneNumber: number,
    message: string
  ): Promise<void> {
    await saveRunState(state, this.area);
    await this.writeLog(sceneNumber, "Error", message);
    await this.actions.notifyRateLimit?.(sceneNumber);
  }

  private async handleSceneError(state: RunState, sceneNumber: number, sceneIndex: number, message: string): Promise<void> {
    const attempts = state.pendingRetry?.sceneIndex === sceneIndex ? state.pendingRetry.attempts : 0;

    if (attempts < 1) {
      const retrying: RunState = {
        ...state,
        status: "retrying",
        currentIndex: sceneIndex,
        pendingRetry: {
          sceneIndex,
          attempts: attempts + 1
        },
        errorMessage: message,
        message: "Reload page"
      };
      await saveRunState(retrying, this.area);
      this.actions.reloadPage();
      return;
    }

    const failed = {
      ...freezeRuntime(state, this.actions.now()),
      status: "error" as const,
      currentIndex: sceneIndex,
      errorMessage: message,
      message: "Stopped."
    };
    await saveRunState(failed, this.area);
    await this.writeLog(sceneNumber, "Error", `${message} Stopped.`);
  }

  private async pauseNow(state: RunState): Promise<void> {
    const paused = {
      ...freezeRuntime(state, this.actions.now()),
      status: "paused" as const,
      pausedAt: this.actions.now(),
      message: "Paused."
    };
    await saveRunState(paused, this.area);
  }

  private async complete(state: RunState, isTest: boolean): Promise<void> {
    const completed = {
      ...freezeRuntime(state, this.actions.now()),
      status: "completed" as const,
      pausedAt: null,
      pendingRetry: undefined,
      errorMessage: null,
      message: isTest ? "Test completed successfully." : "Completed."
    };
    await saveRunState(completed, this.area);
    const completedSceneCount = isTest ? Math.min(TEST_SCENE_LIMIT, state.totalScenes) : state.totalScenes;
    this.actions.notifyWhenGenerationsComplete?.(completedSceneCount, () => this.stopRequested);
  }

  private async failBeforeStart(message: string, batch: StoredBatch): Promise<RunState> {
    const failed = {
      ...createIdleState(),
      status: "error" as const,
      totalScenes: batch.sceneCount,
      batchId: batch.id,
      errorMessage: message,
      message
    };
    await saveRunState(failed, this.area);
    throw new HumanError(message);
  }
}

function getMaxExclusive(batch: StoredBatch, mode: RunMode): number {
  return mode === "test" ? Math.min(TEST_SCENE_LIMIT, batch.sceneCount) : batch.sceneCount;
}

function isCompletedTestForBatch(state: RunState, batch: StoredBatch): boolean {
  return (
    state.status === "completed" &&
    state.mode === "test" &&
    state.batchId === batch.id &&
    state.lastCompletedIndex >= 0
  );
}

export function formatScenePrompt(scene: Scene): string {
  return `СЦЕНА ${scene.sceneNumber} — ПРОМПТ:\n${scene.prompt}`;
}

async function requireBatch(area: StorageAreaLike): Promise<StoredBatch> {
  const batch = await loadBatch(area);

  if (!batch) {
    throw new HumanError("TXT file not selected.");
  }

  if (batch.sceneCount === 0) {
    throw new HumanError("No scenes found in TXT.");
  }

  return batch;
}
