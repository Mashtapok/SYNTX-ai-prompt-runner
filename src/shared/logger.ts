import { appendLog, type StorageAreaLike } from "./storage";
import type { LogEntry, LogStatus } from "./types";

export function createLogEntry(sceneNumber: number | null, status: LogStatus, message?: string, now = Date.now()): LogEntry {
  return {
    id: `${now}-${sceneNumber ?? "system"}-${Math.random().toString(16).slice(2)}`,
    time: now,
    sceneNumber,
    status,
    message
  };
}

export async function logScene(area: StorageAreaLike, sceneNumber: number | null, status: LogStatus, message?: string): Promise<void> {
  await appendLog(createLogEntry(sceneNumber, status, message), area);
}
