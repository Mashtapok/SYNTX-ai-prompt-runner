import {
  createSelectorForElement,
  generateElementFromClickTarget,
  promptElementFromClickTarget,
  validatePage
} from "./dom";
import { HumanError } from "../shared/errors";
import {
  loadLearningSelectors,
  resetLearningSelectors,
  saveLearningSelectors,
  type StorageAreaLike
} from "../shared/storage";
import type { LearningCommandResult, LearningSelectors } from "../shared/types";

const OVERLAY_ID = "syntx-prompt-runner-learning";

let activeController: AbortController | null = null;

interface LearningClickResult {
  element: HTMLElement;
  clickedSelector: string;
}

export async function startLearning(
  area: StorageAreaLike,
  onSelectorsSaved: (selectors: LearningSelectors | null) => void
): Promise<LearningCommandResult> {
  activeController?.abort();
  activeController = new AbortController();
  const controller = activeController;

  runLearningFlow(area, controller.signal, onSelectorsSaved).catch((error) => {
    if (!controller.signal.aborted) {
      showLearningOverlay(error instanceof Error ? error.message : "Learning failed.");
    }
  });

  const selectors = await loadLearningSelectors(area);
  return {
    message: "Click Prompt field on the SynteX page.",
    selectors
  };
}

export async function resetLearning(
  area: StorageAreaLike,
  onSelectorsSaved: (selectors: LearningSelectors | null) => void
): Promise<LearningCommandResult> {
  activeController?.abort();
  activeController = null;
  removeLearningOverlay();
  await resetLearningSelectors(area);
  onSelectorsSaved(null);

  return {
    message: "Learning reset.",
    selectors: null
  };
}

async function runLearningFlow(
  area: StorageAreaLike,
  signal: AbortSignal,
  onSelectorsSaved: (selectors: LearningSelectors | null) => void
): Promise<void> {
  showLearningOverlay("Learning mode: click Prompt field.");

  const promptClick = await waitForElementClick(
    signal,
    "Click the Prompt field.",
    promptElementFromClickTarget,
    "Click the Prompt input field."
  );
  const promptSelector = createSelectorForElement(promptClick.element);
  const promptSelectors: LearningSelectors = {
    promptSelector,
    updatedAt: Date.now()
  };
  await saveLearningSelectors(promptSelectors, area);
  onSelectorsSaved(promptSelectors);
  logLearningClick("Prompt field", promptClick.clickedSelector, promptSelector);
  showLearningOverlay("✓ Prompt field saved\nClick Generate button.");

  const generateClick = await waitForElementClick(
    signal,
    "Click the Generate button.",
    generateElementFromClickTarget,
    "Click the Generate button."
  );
  const generateSelector = createSelectorForElement(generateClick.element);
  const selectors: LearningSelectors = {
    promptSelector,
    generateSelector,
    updatedAt: Date.now()
  };
  await saveLearningSelectors(selectors, area);
  onSelectorsSaved(selectors);
  logLearningClick("Generate button", generateClick.clickedSelector, generateSelector);

  const validation = validatePage(document, selectors);

  if (!validation.ok) {
    showLearningOverlay(`Learning failed.\n${validation.errors[0] ?? "Unable to continue."}`);
    throw new HumanError(validation.errors[0] ?? "Learning failed.");
  }

  showLearningOverlay("✓ Generate button saved\nLearning completed successfully.");
  window.setTimeout(removeLearningOverlay, 3000);
}

function waitForElementClick(
  signal: AbortSignal,
  instruction: string,
  resolveTarget: (target: EventTarget | null) => HTMLElement | null,
  invalidMessage: string
): Promise<LearningClickResult> {
  showLearningOverlay(instruction);

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      document.removeEventListener("click", onClick, true);
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new HumanError("Learning stopped."));
    };
    const onClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const clickedSelector = selectorFromEventTarget(event.target);
      const element = resolveTarget(event.target);

      if (!element) {
        console.log("[SynteX Runner] Learning click ignored", {
          step: instruction,
          clickedSelector,
          savedSelector: null,
          reason: invalidMessage
        });
        showLearningOverlay(invalidMessage);
        return;
      }

      cleanup();
      resolve({
        element,
        clickedSelector
      });
    };

    signal.addEventListener("abort", onAbort);
    document.addEventListener("click", onClick, true);
  });
}

function logLearningClick(step: string, clickedSelector: string, savedSelector: string): void {
  console.log("[SynteX Runner] Learning click saved", {
    step,
    clickedSelector,
    savedSelector
  });
}

function selectorFromEventTarget(target: EventTarget | null): string {
  if (!(target instanceof Element)) {
    return "unknown";
  }

  const path: string[] = [];
  let current: Element | null = target;

  while (current && current !== document.documentElement && path.length < 6) {
    path.unshift(selectorSegment(current));
    current = current.parentElement;
  }

  return path.join(" > ");
}

function selectorSegment(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const id = element.getAttribute("id");

  if (id) {
    return `${tag}#${cssEscape(id)}`;
  }

  const testId = element.getAttribute("data-testid") ?? element.getAttribute("data-test");

  if (testId) {
    return `${tag}[data-testid="${cssEscape(testId)}"]`;
  }

  const ariaLabel = element.getAttribute("aria-label");

  if (ariaLabel) {
    return `${tag}[aria-label="${cssEscape(ariaLabel)}"]`;
  }

  return tag;
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return value.replace(/["\\]/g, "\\$&");
}

function showLearningOverlay(message: string): void {
  const overlay = ensureLearningOverlay();
  overlay.textContent = message;
}

function ensureLearningOverlay(): HTMLElement {
  const existing = document.getElementById(OVERLAY_ID);

  if (existing) {
    return existing;
  }

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.style.position = "fixed";
  overlay.style.zIndex = "2147483647";
  overlay.style.top = "16px";
  overlay.style.left = "50%";
  overlay.style.transform = "translateX(-50%)";
  overlay.style.width = "calc(100vw - 32px)";
  overlay.style.maxWidth = "560px";
  overlay.style.boxSizing = "border-box";
  overlay.style.padding = "18px 24px";
  overlay.style.border = "1px solid rgba(23, 92, 211, 0.35)";
  overlay.style.borderRadius = "8px";
  overlay.style.background = "#ffffff";
  overlay.style.boxShadow = "0 12px 34px rgba(16, 24, 40, 0.18)";
  overlay.style.color = "#101828";
  overlay.style.font = "600 16px/1.5 system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  overlay.style.pointerEvents = "none";
  overlay.style.whiteSpace = "pre-line";
  document.documentElement.appendChild(overlay);
  return overlay;
}

function removeLearningOverlay(): void {
  document.getElementById(OVERLAY_ID)?.remove();
}
