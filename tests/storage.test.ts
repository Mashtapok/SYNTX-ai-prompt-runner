import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, MAX_LOG_ENTRIES } from "../src/shared/constants";
import { createReadyState } from "../src/shared/state";
import {
  appendLog,
  loadBatch,
  loadLearningSelectors,
  loadLogs,
  loadRunState,
  loadSettings,
  MemoryStorageArea,
  resetLearningSelectors,
  saveBatch,
  saveLearningSelectors,
  saveRunState,
  saveSettings
} from "../src/shared/storage";
import type { StoredBatch } from "../src/shared/types";

describe("storage", () => {
  it("returns default settings", async () => {
    const area = new MemoryStorageArea();

    await expect(loadSettings(area)).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it("persists settings, batch, and checkpoint state", async () => {
    const area = new MemoryStorageArea();
    const batch = makeBatch(5);
    const state = {
      ...createReadyState(batch),
      lastCompletedIndex: 2,
      currentIndex: 3
    };

    await saveSettings({ intervalSec: 15 }, area);
    await saveBatch(batch, area);
    await saveRunState(state, area);

    await expect(loadSettings(area)).resolves.toEqual({ intervalSec: 15 });
    await expect(loadBatch(area)).resolves.toEqual(batch);
    await expect(loadRunState(area)).resolves.toMatchObject({ lastCompletedIndex: 2, currentIndex: 3 });
  });

  it("caps logs while preserving enough entries for large runs", async () => {
    const area = new MemoryStorageArea();

    for (let index = 0; index < MAX_LOG_ENTRIES + 5; index += 1) {
      await appendLog(
        {
          id: String(index),
          time: index,
          sceneNumber: index,
          status: "Success"
        },
        area
      );
    }

    const logs = await loadLogs(area);
    expect(logs).toHaveLength(MAX_LOG_ENTRIES);
    expect(logs[0].id).toBe("5");
  });

  it("persists and resets learned selectors", async () => {
    const area = new MemoryStorageArea();
    const selectors = {
      promptSelector: "#prompt",
      generateSelector: "#generate",
      updatedAt: 1
    };

    await saveLearningSelectors(selectors, area);
    await expect(loadLearningSelectors(area)).resolves.toEqual(selectors);

    await resetLearningSelectors(area);
    await expect(loadLearningSelectors(area)).resolves.toBeNull();
  });
});

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
