import { TEST_SCENE_LIMIT } from "../shared/constants";
import { runtimeMs } from "../shared/state";
import type { RunState, Settings } from "../shared/types";

export interface ProgressView {
  completed: number;
  currentScene: number;
  totalScenes: number;
  percent: number;
  elapsedMs: number;
  remainingMs: number;
  averageMs: number;
}

export function getProgressView(state: RunState, settings: Settings, now = Date.now()): ProgressView {
  const totalScenes = state.totalScenes;
  const completed = Math.max(0, Math.min(totalScenes, state.lastCompletedIndex + 1));
  const currentScene =
    state.status === "idle" || state.status === "ready"
      ? 0
      : Math.max(1, Math.min(totalScenes, state.status === "completed" ? totalScenes : state.currentIndex + 1));
  const percent = totalScenes === 0 ? 0 : Math.floor((completed / totalScenes) * 100);
  const elapsedMs = runtimeMs(state, now);
  const generationElapsedMs = state.generationElapsedMs ?? 0;
  const generationCompletedCount = state.generationCompletedCount ?? 0;
  const averageMs = generationCompletedCount > 0 ? generationElapsedMs / generationCompletedCount : 0;
  const targetTotal = state.mode === "test" ? Math.min(TEST_SCENE_LIMIT, totalScenes) : totalScenes;
  const remainingScenes = Math.max(0, targetTotal - completed);

  return {
    completed,
    currentScene,
    totalScenes,
    percent,
    elapsedMs,
    remainingMs: remainingScenes * settings.intervalSec * 1000,
    averageMs
  };
}
