import { DEFAULT_SETTINGS, MAX_LOG_ENTRIES, STORAGE_KEYS } from "./constants";
import { createIdleState } from "./state";
import type { LearningSelectors, LogEntry, RunState, Settings, StoredBatch } from "./types";

export interface StorageAreaLike {
  get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export function chromeStorageArea(): StorageAreaLike {
  return {
    get: (keys) => chrome.storage.local.get(keys),
    set: (items) => chrome.storage.local.set(items),
    remove: (keys) => chrome.storage.local.remove(keys)
  };
}

export class MemoryStorageArea implements StorageAreaLike {
  private data = new Map<string, unknown>();

  async get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> {
    if (!keys) {
      return Object.fromEntries(this.data);
    }

    if (typeof keys === "string") {
      return { [keys]: this.data.get(keys) };
    }

    if (Array.isArray(keys)) {
      return Object.fromEntries(keys.map((key) => [key, this.data.get(key)]));
    }

    return Object.fromEntries(
      Object.entries(keys).map(([key, defaultValue]) => [key, this.data.has(key) ? this.data.get(key) : defaultValue])
    );
  }

  async set(items: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(items)) {
      this.data.set(key, value);
    }
  }

  async remove(keys: string | string[]): Promise<void> {
    const list = Array.isArray(keys) ? keys : [keys];

    for (const key of list) {
      this.data.delete(key);
    }
  }
}

export async function loadSettings(area = chromeStorageArea()): Promise<Settings> {
  const result = await area.get({ [STORAGE_KEYS.settings]: DEFAULT_SETTINGS });
  const settings = result[STORAGE_KEYS.settings] as Settings | undefined;
  return normalizeSettings(settings);
}

export async function saveSettings(settings: Settings, area = chromeStorageArea()): Promise<void> {
  await area.set({ [STORAGE_KEYS.settings]: normalizeSettings(settings) });
}

export async function loadLearningSelectors(area = chromeStorageArea()): Promise<LearningSelectors | null> {
  const result = await area.get(STORAGE_KEYS.learningSelectors);
  const selectors = result[STORAGE_KEYS.learningSelectors] as LearningSelectors | undefined;

  if (!selectors?.promptSelector && !selectors?.generateSelector) {
    return null;
  }

  return selectors;
}

export async function saveLearningSelectors(selectors: LearningSelectors, area = chromeStorageArea()): Promise<void> {
  await area.set({ [STORAGE_KEYS.learningSelectors]: selectors });
}

export async function resetLearningSelectors(area = chromeStorageArea()): Promise<void> {
  await area.remove(STORAGE_KEYS.learningSelectors);
}

export async function loadBatch(area = chromeStorageArea()): Promise<StoredBatch | null> {
  const result = await area.get(STORAGE_KEYS.batch);
  return (result[STORAGE_KEYS.batch] as StoredBatch | undefined) ?? null;
}

export async function saveBatch(batch: StoredBatch, area = chromeStorageArea()): Promise<void> {
  await area.set({ [STORAGE_KEYS.batch]: batch });
}

export async function loadRunState(area = chromeStorageArea()): Promise<RunState> {
  const result = await area.get(STORAGE_KEYS.runState);
  return (result[STORAGE_KEYS.runState] as RunState | undefined) ?? createIdleState();
}

export async function saveRunState(state: RunState, area = chromeStorageArea()): Promise<void> {
  await area.set({ [STORAGE_KEYS.runState]: state });
}

export async function loadLogs(area = chromeStorageArea()): Promise<LogEntry[]> {
  const result = await area.get(STORAGE_KEYS.logs);
  return (result[STORAGE_KEYS.logs] as LogEntry[] | undefined) ?? [];
}

export async function saveLogs(logs: LogEntry[], area = chromeStorageArea()): Promise<void> {
  await area.set({ [STORAGE_KEYS.logs]: logs.slice(-MAX_LOG_ENTRIES) });
}

export async function appendLog(entry: LogEntry, area = chromeStorageArea()): Promise<LogEntry[]> {
  const logs = await loadLogs(area);
  const nextLogs = [...logs, entry].slice(-MAX_LOG_ENTRIES);
  await saveLogs(nextLogs, area);
  return nextLogs;
}

export async function clearLogs(area = chromeStorageArea()): Promise<void> {
  await saveLogs([], area);
}

function normalizeSettings(settings?: Partial<Settings>): Settings {
  const intervalSec = Number(settings?.intervalSec ?? DEFAULT_SETTINGS.intervalSec);

  return {
    intervalSec: Number.isFinite(intervalSec) ? Math.min(3600, Math.max(1, Math.round(intervalSec))) : DEFAULT_SETTINGS.intervalSec
  };
}
