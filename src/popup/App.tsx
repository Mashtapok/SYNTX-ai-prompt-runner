import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileUp, FlaskConical, MousePointerClick, Pause, Play, RotateCcw, Square } from "lucide-react";
import { createBatchFromFile } from "./batch";
import { sendToActiveTab } from "./chrome";
import { getProgressView } from "./progress";
import { DEFAULT_SETTINGS, STORAGE_KEYS } from "../shared/constants";
import { toHumanMessage } from "../shared/errors";
import {
  clearLogs,
  loadBatch,
  loadLearningSelectors,
  loadLogs,
  loadRunState,
  loadSettings,
  resetLearningSelectors,
  saveBatch,
  saveRunState,
  saveSettings
} from "../shared/storage";
import { createReadyState } from "../shared/state";
import { formatClock, formatDuration, formatRemaining } from "../shared/time";
import type { LearningCommandResult, LearningSelectors, LogEntry, RunState, Settings, StoredBatch } from "../shared/types";

export function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [intervalValue, setIntervalValue] = useState(String(DEFAULT_SETTINGS.intervalSec));
  const [batch, setBatch] = useState<StoredBatch | null>(null);
  const [learningSelectors, setLearningSelectors] = useState<LearningSelectors | null>(null);
  const [runState, setRunState] = useState<RunState | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const intervalEditingRef = useRef(false);

  const refresh = useCallback(async () => {
    const [storedSettings, storedBatch, storedLearningSelectors, storedState, storedLogs] = await Promise.all([
      loadSettings(),
      loadBatch(),
      loadLearningSelectors(),
      loadRunState(),
      loadLogs()
    ]);

    setSettings(storedSettings);
    if (!intervalEditingRef.current) {
      setIntervalValue(String(storedSettings.intervalSec));
    }
    setBatch(storedBatch);
    setLearningSelectors(storedLearningSelectors);
    setRunState(storedState);
    setLogs(storedLogs);

    try {
      const liveState = await sendToActiveTab<RunState>({ type: "GET_STATUS" });
      setRunState(liveState);
      const liveLearning = await sendToActiveTab<LearningCommandResult>({ type: "GET_LEARNING" });
      setLearningSelectors(liveLearning.selectors);
    } catch {
      // Storage state is enough when the popup is opened away from SynteX.
    }
  }, []);

  useEffect(() => {
    refresh().catch((refreshError) => setError(toHumanMessage(refreshError)));

    const interval = window.setInterval(() => {
      setNow(Date.now());
      refresh().catch(() => undefined);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "local" || !changes[STORAGE_KEYS.logs]) {
        return;
      }

      setLogs((changes[STORAGE_KEYS.logs].newValue as LogEntry[] | undefined) ?? []);
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  const progress = useMemo(
    () => getProgressView(runState ?? defaultVisibleState(batch), settings, now),
    [batch, now, runState, settings]
  );

  const isActive = runState?.status === "running" || runState?.status === "waiting" || runState?.status === "retrying";
  const canResume = Boolean(batch && !isActive && (runState?.lastCompletedIndex ?? -1) + 1 < batch.sceneCount);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const nextBatch = await createBatchFromFile(file);
      const readyState = createReadyState(nextBatch);
      await Promise.all([saveBatch(nextBatch), saveRunState(readyState), clearLogs()]);
      setBatch(nextBatch);
      setRunState(readyState);
      setLogs([]);
    } catch (fileError) {
      setError(toHumanMessage(fileError));
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  async function persistInterval(value: string) {
    const trimmed = value.trim();
    const intervalSec = Number(trimmed);

    if (trimmed === "" || !Number.isFinite(intervalSec)) {
      throw new Error("Interval must be a number.");
    }

    const nextSettings = {
      intervalSec: Math.min(3600, Math.max(1, Math.round(intervalSec)))
    };
    await saveSettings(nextSettings);
    setSettings(nextSettings);
    setIntervalValue(String(nextSettings.intervalSec));
  }

  async function handleIntervalBlur() {
    try {
      await persistInterval(intervalValue);
    } catch (intervalError) {
      setError(toHumanMessage(intervalError));
    } finally {
      intervalEditingRef.current = false;
    }
  }

  async function runCommand(type: "START_RUN" | "START_TEST" | "PAUSE_RUN" | "RESUME_RUN" | "STOP_RUN") {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      await persistInterval(intervalValue);
      const state = await sendToActiveTab<RunState>({ type });
      setRunState(state);
      await refresh();
    } catch (commandError) {
      setError(toHumanMessage(commandError));
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function startLearning() {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const result = await sendToActiveTab<LearningCommandResult>({ type: "START_LEARNING" });
      setLearningSelectors(result.selectors);
      setNotice(result.message);
    } catch (learningError) {
      setError(toHumanMessage(learningError));
    } finally {
      setBusy(false);
    }
  }

  async function resetLearning() {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      await resetLearningSelectors();
      await sendToActiveTab<LearningCommandResult>({ type: "RESET_LEARNING" }).catch(() => null);
      setLearningSelectors(null);
      setNotice("Learning reset.");
    } catch (resetError) {
      setError(toHumanMessage(resetError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app">
      <header className="header">
        <div>
          <h1>SynteX Runner</h1>
          <p>{batch ? batch.fileName : "TXT file not selected."}</p>
        </div>
        <span className={`status status-${runState?.status ?? "idle"}`}>{runState?.status ?? "idle"}</span>
      </header>

      <section className="section file-row">
        <label className="file-button">
          <FileUp aria-hidden="true" className="button-icon" />
          Choose TXT
          <input accept=".txt,text/plain" type="file" onChange={handleFileChange} />
        </label>
        <label className="interval-control">
          <span>Interval</span>
          <input
            min="1"
            step="1"
            type="number"
            value={intervalValue}
            onBlur={handleIntervalBlur}
            onChange={(event) => setIntervalValue(event.target.value)}
            onFocus={() => {
              intervalEditingRef.current = true;
            }}
          />
          <span>sec</span>
        </label>
      </section>

      <section className="controls">
        <button disabled={busy || !batch || isActive} type="button" onClick={() => runCommand("START_RUN")}>
          <Play aria-hidden="true" className="button-icon" />
          Start
        </button>
        <button disabled={busy || !batch || isActive} type="button" onClick={() => runCommand("START_TEST")}>
          <FlaskConical aria-hidden="true" className="button-icon" />
          Test
        </button>
        <button disabled={busy || !isActive} type="button" onClick={() => runCommand("PAUSE_RUN")}>
          <Pause aria-hidden="true" className="button-icon" />
          Pause
        </button>
        <button disabled={busy || !canResume} type="button" onClick={() => runCommand("RESUME_RUN")}>
          <Play aria-hidden="true" className="button-icon" />
          Resume
        </button>
        <button
          className="stop-button"
          disabled={busy || !runState || runState.status === "idle" || runState.status === "ready"}
          type="button"
          onClick={() => runCommand("STOP_RUN")}
        >
          <Square aria-hidden="true" className="button-icon" />
          Stop
        </button>
      </section>

      <section className="section learning-row">
        <div>
          <span>Learning</span>
          <strong>{learningLabel(learningSelectors)}</strong>
        </div>
        <button disabled={busy || isActive} type="button" onClick={startLearning}>
          <MousePointerClick aria-hidden="true" className="button-icon" />
          Learn
        </button>
        <button disabled={busy || isActive || !learningSelectors} type="button" onClick={resetLearning}>
          <RotateCcw aria-hidden="true" className="button-icon" />
          Reset Learning
        </button>
      </section>

      {error ? <div className="error">{error}</div> : null}
      {notice ? <div className="message">{notice}</div> : null}
      {runState?.message ? <div className="message">{runState.message}</div> : null}
      {runState?.errorMessage ? <div className="error">{runState.errorMessage}</div> : null}

      <section className="progress">
        <div className="progress-top">
          <div>
            <span>Scene</span>
            <strong>
              {progress.completed} / {progress.totalScenes}
            </strong>
          </div>
          <div>
            <span>Current</span>
            <strong>{progress.currentScene || "-"}</strong>
          </div>
          <div>
            <span>Done</span>
            <strong>{progress.percent}%</strong>
          </div>
        </div>
        <div className="bar">
          <div style={{ width: `${progress.percent}%` }} />
        </div>
        <div className="timer-grid">
          <Timer label="Elapsed" value={formatDuration(progress.elapsedMs)} />
          <Timer label="Remaining" value={formatRemaining(progress.remainingMs)} />
          <Timer label="Average" value={`${(progress.averageMs / 1000).toFixed(1)} sec / scene`} />
        </div>
      </section>

      <section className="log-section">
        <div className="section-title">Log</div>
        <div className="log-list">
          {logs.length === 0 ? (
            <div className="empty-log">No log entries.</div>
          ) : (
            logs.slice(-80).map((entry) => (
              <div className={`log-row log-${entry.status.toLowerCase()}`} key={entry.id}>
                <span>{formatClock(entry.time)}</span>
                <span>{entry.sceneNumber ? `Scene ${entry.sceneNumber}` : "System"}</span>
                <strong>{entry.status}</strong>
                {entry.message ? <em>{entry.message}</em> : null}
              </div>
            ))
          )}
        </div>
      </section>
    </main>
  );
}

function Timer({ label, value }: { label: string; value: string }) {
  return (
    <div className="timer">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function learningLabel(selectors: LearningSelectors | null): string {
  if (selectors?.promptSelector && selectors.generateSelector) {
    return "Prompt + Generate saved";
  }

  if (selectors?.promptSelector) {
    return "Prompt saved, Generate pending";
  }

  if (selectors?.generateSelector) {
    return "Generate saved, Prompt pending";
  }

  return "Default selectors active";
}

function defaultVisibleState(batch: StoredBatch | null): RunState {
  return {
    status: batch ? "ready" : "idle",
    mode: "full",
    currentIndex: 0,
    lastCompletedIndex: -1,
    totalScenes: batch?.sceneCount ?? 0,
    startedAt: null,
    pausedAt: null,
    elapsedActiveMs: 0,
    generationElapsedMs: 0,
    generationCompletedCount: 0,
    errorMessage: null,
    batchId: batch?.id ?? null,
    message: null
  };
}
