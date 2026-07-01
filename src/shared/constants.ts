import type { Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  intervalSec: 30
};

export const STORAGE_KEYS = {
  settings: "syntx.settings",
  batch: "syntx.batch",
  runState: "syntx.runState",
  logs: "syntx.logs",
  learningSelectors: "syntx.learningSelectors"
} as const;

export const MAX_LOG_ENTRIES = 1500;
export const TEST_SCENE_LIMIT = 2;
