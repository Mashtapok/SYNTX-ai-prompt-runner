import type { RunMode, RunState, StoredBatch } from "./types";

export function createIdleState(): RunState {
  return {
    status: "idle",
    mode: "full",
    currentIndex: 0,
    lastCompletedIndex: -1,
    totalScenes: 0,
    startedAt: null,
    pausedAt: null,
    elapsedActiveMs: 0,
    generationElapsedMs: 0,
    generationCompletedCount: 0,
    errorMessage: null,
    batchId: null,
    message: null
  };
}

export function createReadyState(batch: StoredBatch): RunState {
  return {
    ...createIdleState(),
    status: "ready",
    totalScenes: batch.sceneCount,
    batchId: batch.id,
    message: "TXT loaded."
  };
}

export function createActiveState(batch: StoredBatch, mode: RunMode, currentIndex: number, now: number): RunState {
  return {
    status: "running",
    mode,
    currentIndex,
    lastCompletedIndex: currentIndex - 1,
    totalScenes: batch.sceneCount,
    startedAt: now,
    pausedAt: null,
    elapsedActiveMs: 0,
    generationElapsedMs: 0,
    generationCompletedCount: 0,
    errorMessage: null,
    batchId: batch.id,
    message: null
  };
}

export function runtimeMs(state: RunState, now = Date.now()): number {
  if (state.startedAt && isActiveStatus(state.status)) {
    return state.elapsedActiveMs + Math.max(0, now - state.startedAt);
  }

  return state.elapsedActiveMs;
}

export function freezeRuntime(state: RunState, now: number): RunState {
  return {
    ...state,
    startedAt: null,
    elapsedActiveMs: runtimeMs(state, now)
  };
}

export function resumeRuntime(state: RunState, now: number): RunState {
  return {
    ...state,
    startedAt: now,
    pausedAt: null
  };
}

export function isActiveStatus(status: RunState["status"]): boolean {
  return status === "running" || status === "waiting" || status === "retrying";
}
