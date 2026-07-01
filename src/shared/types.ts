export type RunStatus =
  | "idle"
  | "ready"
  | "running"
  | "waiting"
  | "paused"
  | "completed"
  | "stopped"
  | "error"
  | "retrying";

export type RunMode = "full" | "test";

export type LogStatus = "Success" | "Error" | "Info";

export interface Scene {
  index: number;
  sceneNumber: number;
  prompt: string;
}

export interface StoredBatch {
  id: string;
  fileName: string;
  size: number;
  lastModified: number;
  sceneCount: number;
  scenes: Scene[];
}

export interface Settings {
  intervalSec: number;
}

export interface LearningSelectors {
  promptSelector?: string;
  generateSelector?: string;
  updatedAt: number;
}

export interface PendingRetry {
  sceneIndex: number;
  attempts: number;
}

export interface RunState {
  status: RunStatus;
  mode: RunMode;
  currentIndex: number;
  lastCompletedIndex: number;
  totalScenes: number;
  startedAt: number | null;
  pausedAt: number | null;
  elapsedActiveMs: number;
  generationElapsedMs: number;
  generationCompletedCount: number;
  errorMessage: string | null;
  batchId: string | null;
  pendingRetry?: PendingRetry;
  message?: string | null;
}

export interface LogEntry {
  id: string;
  time: number;
  sceneNumber: number | null;
  status: LogStatus;
  message?: string;
}

export type ImageDownloadResult =
  | { status: "started" }
  | { status: "error"; message: string };

export type ExtensionRequest =
  | { type: "PING" }
  | { type: "VALIDATE_PAGE" }
  | { type: "START_LEARNING" }
  | { type: "RESET_LEARNING" }
  | { type: "GET_LEARNING" }
  | { type: "START_RUN" }
  | { type: "START_TEST" }
  | { type: "PAUSE_RUN" }
  | { type: "RESUME_RUN" }
  | { type: "STOP_RUN" }
  | { type: "GET_STATUS" };

export type ExtensionResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; state?: RunState };

export interface PageValidation {
  ok: boolean;
  errors: string[];
}

export interface LearningCommandResult {
  message: string;
  selectors: LearningSelectors | null;
}

export interface RateLimitSignal {
  statusCode: 429;
  url: string;
  time: number;
}

export interface ExtensionNotification {
  id: string;
  title: string;
  message: string;
  requireInteraction?: boolean;
}

export type BackgroundRequest =
  | { type: "CLEAR_RATE_LIMIT_SIGNAL" }
  | { type: "TAKE_RATE_LIMIT_SIGNAL"; since?: number }
  | { type: "SHOW_NOTIFICATION"; notification: ExtensionNotification }
  | { type: "REGISTER_DOWNLOAD_NAME"; sceneNumber: number };

export type BackgroundResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };
