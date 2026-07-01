import { SkeletonTracker, submitPrompt, validatePage, type SkeletonSnapshot } from "./dom";
import { resetLearning, startLearning } from "./learning";
import { notifyRateLimit, notifyRunCompleted } from "./notifications";
import { clearRateLimitSignal, takeRateLimitSignal, watchRateLimitSignal } from "./rateLimit";
import { PromptRunner, type RunnerActions } from "./runner";
import { toHumanMessage } from "../shared/errors";
import { chromeStorageArea, loadLearningSelectors } from "../shared/storage";
import type { ExtensionRequest, ExtensionResponse, LearningSelectors } from "../shared/types";

const CONTENT_READY_KEY = "__syntxPromptRunnerContentReady";
const storageArea = chromeStorageArea();
const skeletonTracker = new SkeletonTracker(document);
let learnedSelectors: LearningSelectors | null = null;
const learningReady = refreshLearningSelectors();

const actions: RunnerActions = {
  now: () => Date.now(),
  validatePage: () => validatePage(document, learnedSelectors),
  clearRateLimitSignal,
  takeRateLimitSignal,
  watchRateLimitSignal,
  submitPrompt: (prompt) => submitPrompt(prompt, document, learnedSelectors),
  captureGenerationSnapshot: () => skeletonTracker.capture(),
  trackGenerationFromSnapshot: (snapshot, sceneNumber, onComplete, onDownload, shouldStop) =>
    skeletonTracker.trackNext(snapshot as SkeletonSnapshot, sceneNumber, onComplete, onDownload, shouldStop),
  stopGenerationTracking: () => skeletonTracker.stop(),
  cancelGenerationIdleWait: () => skeletonTracker.stopIdleWaits(),
  notifyRateLimit,
  notifyWhenGenerationsComplete: (sceneCount, shouldStop) => {
    skeletonTracker.waitForIdle(() => void notifyRunCompleted(sceneCount), shouldStop);
  },
  reloadPage: () => window.location.reload(),
  sleep: (ms, shouldStop) =>
    new Promise((resolve) => {
      const startedAt = Date.now();
      const interval = window.setInterval(() => {
        if (shouldStop()) {
          window.clearInterval(interval);
          resolve("stopped");
          return;
        }

        if (Date.now() - startedAt >= ms) {
          window.clearInterval(interval);
          resolve("done");
        }
      }, 250);
    })
};

const runner = new PromptRunner(storageArea, actions);

const contentGlobal = globalThis as typeof globalThis & Record<string, unknown>;

if (!contentGlobal[CONTENT_READY_KEY]) {
  contentGlobal[CONTENT_READY_KEY] = true;

  chrome.runtime.onMessage.addListener((message: ExtensionRequest, _sender, sendResponse) => {
    handleMessage(message)
      .then((data) => sendResponse({ ok: true, data } satisfies ExtensionResponse))
      .catch(async (error) => {
        sendResponse({
          ok: false,
          error: toHumanMessage(error),
          state: await runner.getStatus().catch(() => undefined)
        } satisfies ExtensionResponse);
      });

    return true;
  });

  window.setTimeout(async () => {
    await learningReady.catch(() => undefined);
    runner.resumeAfterReload().catch(() => undefined);
  }, 1000);
}

async function handleMessage(message: ExtensionRequest): Promise<unknown> {
  await learningReady.catch(() => undefined);

  switch (message.type) {
    case "PING":
      return { ready: true };
    case "VALIDATE_PAGE":
      await refreshLearningSelectors();
      return runner.validatePage();
    case "START_LEARNING":
      return startLearning(storageArea, setLearnedSelectors);
    case "RESET_LEARNING":
      return resetLearning(storageArea, setLearnedSelectors);
    case "GET_LEARNING":
      await refreshLearningSelectors();
      return {
        message: learnedSelectors ? "Learning selectors saved." : "Default selectors active.",
        selectors: learnedSelectors
      };
    case "START_RUN":
      await refreshLearningSelectors();
      return runner.start("full");
    case "START_TEST":
      await refreshLearningSelectors();
      return runner.start("test");
    case "PAUSE_RUN":
      return runner.pause();
    case "RESUME_RUN":
      return runner.resume();
    case "STOP_RUN":
      return runner.stop();
    case "GET_STATUS":
      return runner.getStatus();
    default:
      return { ready: true };
  }
}

async function refreshLearningSelectors(): Promise<void> {
  learnedSelectors = await loadLearningSelectors(storageArea);
}

function setLearnedSelectors(selectors: LearningSelectors | null): void {
  learnedSelectors = selectors;
}
