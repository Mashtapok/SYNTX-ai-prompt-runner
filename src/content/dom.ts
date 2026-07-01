import { HumanError } from "../shared/errors";
import type { BackgroundRequest, ImageDownloadResult, LearningSelectors, PageValidation } from "../shared/types";

const PROMPT_SELECTORS = [
  'textarea[placeholder*="prompt" i]',
  'textarea[aria-label*="prompt" i]',
  'textarea[name*="prompt" i]',
  'textarea',
  '[contenteditable="true"][role="textbox"]',
  '[contenteditable="true"]',
  '[role="textbox"]',
  'input[type="text"][placeholder*="prompt" i]',
  'input[type="text"][aria-label*="prompt" i]'
];

const GENERATE_SELECTORS = [
  'button[aria-label*="generate" i]',
  'button[title*="generate" i]',
  'button[data-testid*="generate" i]',
  'button[type="submit"]',
  '[role="button"][aria-label*="generate" i]',
  '[role="button"][title*="generate" i]'
];

const GENERATE_TEXT = ["generate", "сгенер", "создать", "отправ", "submit", "send"];
const IMAGE_SKELETON_SELECTOR = ".el-skeleton__item.el-skeleton__image.bot-image-item__skeleton";
const DOWNLOAD_BUTTON_SELECTOR = 'button[data-cy="download-file-btn"]';
const GENERATION_ERROR_SELECTOR = ".message-error, .el-alert.el-alert--error[role='alert'], [role='alert'].el-alert--error";
const MESSAGE_ROOT_SELECTOR = ".chat-message, .bot-image-message";

export interface PromptTarget {
  element: HTMLElement;
  kind: "text-control" | "contenteditable";
}

export interface SkeletonSnapshot {
  existing: Set<HTMLElement>;
  existingDownloadButtons: Set<HTMLElement>;
  disabledDownloadButtons: Set<HTMLElement>;
  submittedAt: number;
}

export interface SkeletonTrackerOptions {
  appearTimeoutMs?: number;
  disappearTimeoutMs?: number;
  downloadTimeoutMs?: number;
  pollMs?: number;
}

export function validatePage(root: ParentNode = document, learningSelectors: LearningSelectors | null = null): PageValidation {
  const errors: string[] = [];

  if (!findPromptField(root, learningSelectors)) {
    errors.push("Prompt field not found.");
  }

  if (!findGenerateButton(root, learningSelectors)) {
    errors.push("Generate button not found.");
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

export function submitPrompt(prompt: string, root: ParentNode = document, learningSelectors: LearningSelectors | null = null): void {
  const promptField = findPromptField(root, learningSelectors);

  if (!promptField) {
    throw new HumanError("Prompt field not found.");
  }

  const button = findGenerateButton(root, learningSelectors);

  if (!button) {
    throw new HumanError("Generate button not found.");
  }

  setPromptText(promptField, prompt);
  clickGenerateButton(button);
}

export function findPromptField(root: ParentNode = document, learningSelectors: LearningSelectors | null = null): PromptTarget | null {
  if (learningSelectors?.promptSelector) {
    return learnedPromptTarget(root, learningSelectors.promptSelector);
  }

  const candidates = uniqueElements(PROMPT_SELECTORS.flatMap((selector) => Array.from(root.querySelectorAll<HTMLElement>(selector))))
    .filter(isVisible)
    .filter((element) => !isDisabled(element))
    .map((element) => ({
      element,
      score: scorePromptCandidate(element)
    }))
    .filter((candidate) => candidate.score >= 50)
    .sort((left, right) => right.score - left.score);

  const best = candidates[0]?.element;

  if (!best) {
    return null;
  }

  return {
    element: best,
    kind: isTextControl(best) ? "text-control" : "contenteditable"
  };
}

export function findGenerateButton(root: ParentNode = document, learningSelectors: LearningSelectors | null = null): HTMLElement | null {
  if (learningSelectors?.generateSelector) {
    return learnedGenerateTarget(root, learningSelectors.generateSelector);
  }

  const selectorMatches = uniqueElements(
    GENERATE_SELECTORS.flatMap((selector) => Array.from(root.querySelectorAll<HTMLElement>(selector)))
  );
  const allButtons = Array.from(root.querySelectorAll<HTMLElement>('button, [role="button"]'));
  const candidates = uniqueElements([...selectorMatches, ...allButtons])
    .filter(isVisible)
    .filter((element) => !isDisabled(element))
    .map((element) => ({
      element,
      score: scoreGenerateCandidate(element)
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);

  return candidates[0]?.element ?? null;
}

export function createSelectorForElement(element: HTMLElement, root: ParentNode = document): string {
  const attrSelector = bestAttributeSelector(element, root);

  if (attrSelector) {
    return attrSelector;
  }

  const segments: string[] = [];
  let current: Element | null = element;

  while (current && current instanceof HTMLElement && current !== document.documentElement) {
    segments.unshift(selectorSegment(current));
    const selector = segments.join(" > ");

    if (isUniqueSelector(selector, root)) {
      return selector;
    }

    current = current.parentElement;
  }

  return segments.join(" > ");
}

export function promptElementFromClickTarget(target: EventTarget | null): HTMLElement | null {
  return closestHTMLElement(target, 'textarea, input[type="text"], [contenteditable="true"], [role="textbox"]');
}

export function generateElementFromClickTarget(target: EventTarget | null): HTMLElement | null {
  return closestHTMLElement(target, 'button, [role="button"]');
}

export function hasImageSkeleton(root: ParentNode = document): boolean {
  return getVisibleImageSkeletons(root).length > 0;
}

function getVisibleImageSkeletons(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(IMAGE_SKELETON_SELECTOR)).filter(isVisible);
}

export function waitForImageSkeletonCycle(
  shouldStop: () => boolean,
  root: ParentNode = document,
  options: {
    appearTimeoutMs?: number;
    disappearTimeoutMs?: number;
    pollMs?: number;
    rateLimitCheck?: () => Promise<boolean>;
  } = {}
): Promise<{ status: "completed" | "not-found" | "timeout" | "stopped" | "rate-limited"; durationMs?: number }> {
  const appearTimeoutMs = options.appearTimeoutMs ?? 5000;
  const disappearTimeoutMs = options.disappearTimeoutMs ?? 20 * 60 * 1000;
  const pollMs = options.pollMs ?? 500;

  return new Promise((resolve) => {
    const startedAt = Date.now();
    let appearedAt: number | null = hasImageSkeleton(root) ? Date.now() : null;
    let rateLimitCheckInFlight = false;
    let settled = false;

    const interval = window.setInterval(() => {
      void checkRateLimit();

      if (shouldStop()) {
        cleanup({ status: "stopped" });
        return;
      }

      const now = Date.now();
      const visible = hasImageSkeleton(root);

      if (appearedAt === null) {
        if (visible) {
          appearedAt = now;
          console.log("[SynteX Runner] Image skeleton appeared");
          return;
        }

        if (now - startedAt >= appearTimeoutMs) {
          cleanup({ status: "not-found" });
        }

        return;
      }

      if (!visible) {
        console.log("[SynteX Runner] Image skeleton disappeared", {
          durationMs: now - appearedAt
        });
        cleanup({ status: "completed", durationMs: now - appearedAt });
        return;
      }

      if (now - appearedAt >= disappearTimeoutMs) {
        cleanup({ status: "timeout", durationMs: now - appearedAt });
      }
    }, pollMs);

    void checkRateLimit();

    async function checkRateLimit(): Promise<void> {
      if (!options.rateLimitCheck || rateLimitCheckInFlight || settled) {
        return;
      }

      rateLimitCheckInFlight = true;

      try {
        if ((await options.rateLimitCheck()) && !settled) {
          console.log("[SynteX Runner] 429 rate limit detected");
          cleanup({ status: "rate-limited" });
        }
      } finally {
        rateLimitCheckInFlight = false;
      }
    }

    function cleanup(result: {
      status: "completed" | "not-found" | "timeout" | "stopped" | "rate-limited";
      durationMs?: number;
    }): void {
      if (settled) {
        return;
      }

      settled = true;
      window.clearInterval(interval);
      resolve(result);
    }
  });
}

export class SkeletonTracker {
  private readonly tracked = new Set<HTMLElement>();
  private readonly claimedDownloadButtons = new WeakSet<HTMLElement>();
  private readonly cleanups = new Set<() => void>();
  private readonly idleCleanups = new Set<() => void>();

  constructor(
    private readonly root: ParentNode = document,
    private readonly options: SkeletonTrackerOptions = {}
  ) {}

  capture(): SkeletonSnapshot {
    const downloadButtons = Array.from(this.root.querySelectorAll<HTMLElement>(DOWNLOAD_BUTTON_SELECTOR));

    return {
      existing: new Set(getVisibleImageSkeletons(this.root)),
      existingDownloadButtons: new Set(downloadButtons),
      disabledDownloadButtons: new Set(downloadButtons.filter(isDisabled)),
      submittedAt: Date.now()
    };
  }

  trackNext(
    snapshot: SkeletonSnapshot,
    sceneNumber: number,
    onComplete: (durationMs: number) => void,
    onDownload: (result: ImageDownloadResult) => void,
    onGenerationError: (message: string) => void,
    shouldStop: () => boolean
  ): () => void {
    const appearTimeoutMs = this.options.appearTimeoutMs ?? 15000;
    const disappearTimeoutMs = this.options.disappearTimeoutMs ?? 60 * 60 * 1000;
    const downloadTimeoutMs = this.options.downloadTimeoutMs ?? 15000;
    const pollMs = this.options.pollMs ?? 500;
    let target: HTMLElement | null = null;
    let targetRoot: HTMLElement | null = null;
    let targetAncestors: HTMLElement[] = [];
    let startedAt = 0;
    let skeletonEndedAt: number | null = null;
    let stopped = false;
    let interval = 0;

    const findNewSkeleton = (): HTMLElement | null => {
      const candidates = getVisibleImageSkeletons(this.root).filter(
        (element) => !snapshot.existing.has(element) && !this.tracked.has(element)
      );

      return candidates[candidates.length - 1] ?? null;
    };

    function isActiveSkeleton(element: HTMLElement): boolean {
      return element.isConnected && element.matches(IMAGE_SKELETON_SELECTOR) && isVisible(element);
    }

    const selectTarget = (element: HTMLElement, now: number): void => {
      target = element;
      targetRoot = findMessageRoot(element);
      targetAncestors = collectAncestors(element);
      startedAt = now;
      this.tracked.add(element);
      console.log("[SynteX Runner] Image skeleton tracked", { submittedAt: snapshot.submittedAt });
    };

    const markSkeletonEnded = (now: number): void => {
      if (!target || skeletonEndedAt !== null) {
        return;
      }

      skeletonEndedAt = now;
      const durationMs = now - startedAt;
      console.log("[SynteX Runner] Image skeleton disappeared", { durationMs });
    };

    const startDownload = (): boolean => {
      const button = findDownloadButton(
        targetAncestors,
        snapshot.existingDownloadButtons,
        snapshot.disabledDownloadButtons,
        this.claimedDownloadButtons
      );

      if (!button) {
        return false;
      }

      this.claimedDownloadButtons.add(button);

      try {
        onComplete((skeletonEndedAt ?? Date.now()) - startedAt);
        void chrome.runtime
          .sendMessage({ type: "REGISTER_DOWNLOAD_NAME", sceneNumber } satisfies BackgroundRequest)
          .catch(() => undefined);
        button.click();
        console.log("[SynteX Runner] Image download started", { submittedAt: snapshot.submittedAt });
        onDownload({ status: "started" });
      } catch {
        onDownload({ status: "error", message: "Unable to start image download." });
      }

      cleanup();
      return true;
    };

    const failGeneration = (message: string): void => {
      console.warn("[SynteX Runner] Generation error detected", { submittedAt: snapshot.submittedAt, message });
      onGenerationError(message);
      cleanup();
    };

    const timeout = (): void => {
      console.warn("[SynteX Runner] Image skeleton tracking timed out", { submittedAt: snapshot.submittedAt });
      cleanup();
    };

    const missing = (): void => {
      console.warn("[SynteX Runner] Image skeleton not found after submit", { submittedAt: snapshot.submittedAt });
      cleanup();
    };

    const shouldFinish = (now: number): boolean => {
      if (!target) {
        if (now - snapshot.submittedAt >= appearTimeoutMs) {
          missing();
          return true;
        }

        return false;
      }

      const errorMessage = findGenerationError(targetRoot);

      if (errorMessage) {
        failGeneration(errorMessage);
        return true;
      }

      if (skeletonEndedAt === null && !isActiveSkeleton(target)) {
        markSkeletonEnded(now);
      }

      if (skeletonEndedAt !== null) {
        if (startDownload()) {
          return true;
        }

        if (now - skeletonEndedAt >= downloadTimeoutMs) {
          console.warn("[SynteX Runner] Image download button not found", { submittedAt: snapshot.submittedAt });
          onDownload({ status: "error", message: "Image download button not found." });
          cleanup();
          return true;
        }

        return false;
      }

      if (now - startedAt >= disappearTimeoutMs) {
        timeout();
        return true;
      }

      return false;
    };

    const cleanup = (): void => {
      if (stopped) {
        return;
      }

      stopped = true;

      if (target) {
        this.tracked.delete(target);
      }

      window.clearInterval(interval);
      this.cleanups.delete(cleanup);
    };

    const tick = (): void => {
      if (stopped || shouldStop()) {
        cleanup();
        return;
      }

      const now = Date.now();

      if (!target) {
        const next = findNewSkeleton();

        if (next) {
          selectTarget(next, now);
          return;
        }
      }

      shouldFinish(now);
    };

    interval = window.setInterval(tick, pollMs);
    this.cleanups.add(cleanup);
    tick();
    return cleanup;
  }

  waitForIdle(onIdle: () => void, shouldStop: () => boolean = () => false): () => void {
    const pollMs = this.options.pollMs ?? 500;
    let stopped = false;
    let interval = 0;

    const cleanup = (): void => {
      if (stopped) {
        return;
      }

      stopped = true;
      window.clearInterval(interval);
      this.idleCleanups.delete(cleanup);
    };

    const tick = (): void => {
      if (stopped || shouldStop()) {
        cleanup();
        return;
      }

      if (this.cleanups.size === 0 && getVisibleImageSkeletons(this.root).length === 0) {
        cleanup();
        onIdle();
      }
    };

    interval = window.setInterval(tick, pollMs);
    this.idleCleanups.add(cleanup);
    tick();
    return cleanup;
  }

  stopIdleWaits(): void {
    for (const cleanup of Array.from(this.idleCleanups)) {
      cleanup();
    }

    this.idleCleanups.clear();
  }

  stop(): void {
    for (const cleanup of Array.from(this.cleanups)) {
      cleanup();
    }

    this.cleanups.clear();
    this.tracked.clear();
    this.stopIdleWaits();
  }
}

function collectAncestors(element: HTMLElement): HTMLElement[] {
  const ancestors: HTMLElement[] = [];
  let current = element.parentElement;

  while (current) {
    ancestors.push(current);
    current = current.parentElement;
  }

  return ancestors;
}

function findMessageRoot(element: HTMLElement): HTMLElement | null {
  return element.closest<HTMLElement>(MESSAGE_ROOT_SELECTOR);
}

function findGenerationError(root: HTMLElement | null): string | null {
  if (!root?.isConnected) {
    return null;
  }

  const error = root.querySelector<HTMLElement>(GENERATION_ERROR_SELECTOR);

  if (!error || !isVisible(error)) {
    return null;
  }

  return "Generation failed. Retrying scene.";
}

function findDownloadButton(
  ancestors: HTMLElement[],
  existingButtons: Set<HTMLElement>,
  previouslyDisabledButtons: Set<HTMLElement>,
  claimedButtons: WeakSet<HTMLElement>
): HTMLButtonElement | null {
  for (const ancestor of ancestors) {
    if (!ancestor.isConnected) {
      continue;
    }

    const button = Array.from(ancestor.querySelectorAll<HTMLButtonElement>(DOWNLOAD_BUTTON_SELECTOR)).find(
      (candidate) =>
        (!existingButtons.has(candidate) || previouslyDisabledButtons.has(candidate)) &&
        !claimedButtons.has(candidate) &&
        !isDisabled(candidate)
    );

    if (button) {
      return button;
    }
  }

  return null;
}

export function setPromptText(target: PromptTarget, text: string): void {
  const element = target.element;
  element.focus();
  dispatchKeyboard(element, "a", true);
  dispatchKeyboard(element, "Delete");

  if (target.kind === "text-control" && isTextControl(element)) {
    setNativeControlValue(element, "");
    dispatchInput(element, "deleteContentBackward");
    setNativeControlValue(element, text);
    dispatchInput(element, "insertText", text);
    element.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    selectElementContents(element);
    document.execCommand("delete", false);
    const inserted = document.execCommand("insertText", false, text);

    if (!inserted) {
      element.textContent = text;
      dispatchInput(element, "insertText", text);
    }
  }

  const actual = normalizePromptText(readPromptText(target));

  if (actual !== normalizePromptText(text)) {
    throw new HumanError("Unable to insert text.");
  }
}

export function clickGenerateButton(button: HTMLElement): void {
  if (isDisabled(button)) {
    throw new HumanError("Generate button not found.");
  }

  button.focus();
  button.click();
}

function scorePromptCandidate(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  const label = candidateText(element);
  let score = 0;

  if (element instanceof HTMLTextAreaElement) {
    score += 80;
  } else if (isContentEditableTarget(element)) {
    score += 70;
  } else if (element instanceof HTMLInputElement && element.type === "text") {
    score += 20;
  }

  if (label.includes("prompt") || label.includes("промпт")) {
    score += 100;
  }

  if (rect.width >= 300) {
    score += 25;
  }

  if (rect.height >= 40) {
    score += 25;
  }

  if (typeof window !== "undefined" && rect.top > window.innerHeight * 0.45) {
    score += 15;
  }

  if (element instanceof HTMLInputElement && element.type === "search") {
    score -= 100;
  }

  return score;
}

function learnedPromptTarget(root: ParentNode, selector: string): PromptTarget | null {
  const element = queryLearnedElement(root, selector);

  if (!element || !isVisible(element) || isDisabled(element)) {
    return null;
  }

  if (!isTextControl(element) && !isContentEditableTarget(element) && element.getAttribute("role") !== "textbox") {
    return null;
  }

  return {
    element,
    kind: isTextControl(element) ? "text-control" : "contenteditable"
  };
}

function learnedGenerateTarget(root: ParentNode, selector: string): HTMLElement | null {
  const element = queryLearnedElement(root, selector);

  if (!element || !isVisible(element) || isDisabled(element)) {
    return null;
  }

  return element;
}

function queryLearnedElement(root: ParentNode, selector: string): HTMLElement | null {
  try {
    return root.querySelector<HTMLElement>(selector);
  } catch {
    return null;
  }
}

function scoreGenerateCandidate(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  const label = candidateText(element);
  let score = 0;

  if (GENERATE_TEXT.some((text) => label.includes(text))) {
    score += 100;
  }

  if (element instanceof HTMLButtonElement && element.type === "submit") {
    score += 40;
  }

  if (element.querySelector("svg")) {
    score += 10;
  }

  if (typeof window !== "undefined" && rect.top > window.innerHeight * 0.45) {
    score += 10;
  }

  if (rect.width <= 96 && rect.height <= 64) {
    score += 5;
  }

  return score;
}

function candidateText(element: HTMLElement): string {
  return [
    element.textContent,
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.getAttribute("placeholder"),
    element.getAttribute("name"),
    element.getAttribute("data-testid")
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function bestAttributeSelector(element: HTMLElement, root: ParentNode): string | null {
  const tag = element.tagName.toLowerCase();
  const candidates = [
    element.id ? `#${cssEscape(element.id)}` : null,
    attrSelector(tag, "data-testid", element.getAttribute("data-testid")),
    attrSelector(tag, "data-test", element.getAttribute("data-test")),
    attrSelector(tag, "name", element.getAttribute("name")),
    attrSelector(tag, "aria-label", element.getAttribute("aria-label")),
    attrSelector(tag, "placeholder", element.getAttribute("placeholder")),
    element instanceof HTMLInputElement && element.type ? `${tag}[type="${cssEscape(element.type)}"]` : null
  ].filter(Boolean) as string[];

  return candidates.find((selector) => isUniqueSelector(selector, root)) ?? null;
}

function attrSelector(tag: string, name: string, value: string | null): string | null {
  if (!value) {
    return null;
  }

  return `${tag}[${name}="${cssEscape(value)}"]`;
}

function selectorSegment(element: HTMLElement): string {
  const tag = element.tagName.toLowerCase();

  if (!element.parentElement) {
    return tag;
  }

  const siblings = Array.from(element.parentElement.children).filter((child) => child.tagName === element.tagName);
  const position = siblings.indexOf(element) + 1;

  return siblings.length <= 1 ? tag : `${tag}:nth-of-type(${position})`;
}

function isUniqueSelector(selector: string, root: ParentNode): boolean {
  try {
    return root.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return value.replace(/["\\]/g, "\\$&");
}

function closestHTMLElement(target: EventTarget | null, selector: string): HTMLElement | null {
  const element = targetElement(target);
  const match = element?.closest(selector);

  return match instanceof HTMLElement ? match : null;
}

function targetElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) {
    return target;
  }

  if (target instanceof Node) {
    return target.parentElement;
  }

  return null;
}

function isVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);

  return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

function isDisabled(element: HTMLElement): boolean {
  return (
    element.getAttribute("aria-disabled") === "true" ||
    (element instanceof HTMLButtonElement && element.disabled) ||
    (element instanceof HTMLInputElement && element.disabled) ||
    (element instanceof HTMLTextAreaElement && element.disabled)
  );
}

function isTextControl(element: HTMLElement): element is HTMLInputElement | HTMLTextAreaElement {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
}

function isContentEditableTarget(element: HTMLElement): boolean {
  return element.isContentEditable || element.getAttribute("contenteditable") === "true";
}

function setNativeControlValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

  if (!setter) {
    element.value = value;
    return;
  }

  setter.call(element, value);
}

function readPromptText(target: PromptTarget): string {
  if (target.kind === "text-control" && isTextControl(target.element)) {
    return target.element.value;
  }

  return target.element.innerText || target.element.textContent || "";
}

function normalizePromptText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").trim();
}

function selectElementContents(element: HTMLElement): void {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function dispatchInput(element: HTMLElement, inputType: string, data?: string): void {
  element.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      cancelable: true,
      inputType,
      data
    })
  );
}

function dispatchKeyboard(element: HTMLElement, key: string, ctrlKey = false): void {
  element.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key,
      ctrlKey,
      metaKey: ctrlKey
    })
  );
  element.dispatchEvent(
    new KeyboardEvent("keyup", {
      bubbles: true,
      cancelable: true,
      key,
      ctrlKey,
      metaKey: ctrlKey
    })
  );
}

function uniqueElements(elements: HTMLElement[]): HTMLElement[] {
  return Array.from(new Set(elements));
}
