import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSelectorForElement,
  findGenerateButton,
  findPromptField,
  generateElementFromClickTarget,
  hasImageSkeleton,
  SkeletonTracker,
  submitPrompt,
  validatePage
} from "../src/content/dom";

describe("content DOM adapter", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 500,
      width: 500,
      height: 80,
      top: 500,
      right: 500,
      bottom: 580,
      left: 0,
      toJSON: () => ({})
    } as DOMRect);
  });

  it("finds prompt field and generate button", () => {
    document.body.innerHTML = `
      <textarea placeholder="Prompt"></textarea>
      <button aria-label="Generate">Generate</button>
    `;

    expect(findPromptField()).not.toBeNull();
    expect(findGenerateButton()).not.toBeNull();
  });

  it("inserts text and clicks generate without coordinates", () => {
    document.body.innerHTML = `
      <textarea placeholder="Prompt">old</textarea>
      <button aria-label="Generate">Generate</button>
    `;
    const button = document.querySelector("button") as HTMLButtonElement;
    const click = vi.fn();
    button.addEventListener("click", click);

    submitPrompt("new prompt");

    expect((document.querySelector("textarea") as HTMLTextAreaElement).value).toBe("new prompt");
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("reports missing generate button", () => {
    document.body.innerHTML = `<textarea placeholder="Prompt"></textarea>`;

    expect(() => submitPrompt("prompt")).toThrow("Generate button not found.");
  });

  it("uses learned selectors before default selectors", () => {
    document.body.innerHTML = `
      <textarea placeholder="Prompt"></textarea>
      <textarea id="learned"></textarea>
      <button aria-label="Generate">Generate</button>
      <button id="learned-generate">Run</button>
    `;

    const selectors = {
      promptSelector: "#learned",
      generateSelector: "#learned-generate",
      updatedAt: Date.now()
    };

    expect(findPromptField(document, selectors)?.element.id).toBe("learned");
    expect(findGenerateButton(document, selectors)?.id).toBe("learned-generate");
  });

  it("does not fallback when learned selectors are missing", () => {
    document.body.innerHTML = `
      <textarea placeholder="Prompt"></textarea>
      <button aria-label="Generate">Generate</button>
    `;

    expect(validatePage(document, { promptSelector: "#missing", generateSelector: "#missing-button", updatedAt: 1 })).toEqual({
      ok: false,
      errors: ["Prompt field not found.", "Generate button not found."]
    });
  });

  it("creates a unique selector for learned elements", () => {
    document.body.innerHTML = `
      <div>
        <button>Other</button>
        <button id="generate-action">Generate</button>
      </div>
    `;

    expect(createSelectorForElement(document.querySelector("#generate-action") as HTMLElement)).toBe("#generate-action");
  });

  it("resolves a clicked svg path to the parent generate button", () => {
    document.body.innerHTML = `
      <button id="generate-action" aria-label="Generate">
        <svg viewBox="0 0 16 16"><path d="M1 1 L15 8 L1 15" /></svg>
      </button>
    `;

    const path = document.querySelector("path");

    expect(generateElementFromClickTarget(path)?.id).toBe("generate-action");
  });

  it("detects the image skeleton", () => {
    document.body.innerHTML = `
      <div class="el-skeleton__item el-skeleton__image bot-image-item__skeleton"></div>
    `;

    expect(hasImageSkeleton()).toBe(true);
  });

  it("tracks only a new skeleton created after a snapshot", async () => {
    vi.useFakeTimers();
    const tracker = new SkeletonTracker(document, { appearTimeoutMs: 100, disappearTimeoutMs: 1000, pollMs: 10 });

    try {
      document.body.innerHTML = `
        <div id="old" class="el-skeleton__item el-skeleton__image bot-image-item__skeleton"></div>
        <button id="old-download" data-cy="download-file-btn"></button>
      `;
      const snapshot = tracker.capture();
      const complete = vi.fn();
      const downloadResult = vi.fn();
      const oldDownload = vi.fn();
      document.querySelector("#old-download")?.addEventListener("click", oldDownload);

      tracker.trackNext(snapshot, complete, downloadResult, () => false);
      await vi.advanceTimersByTimeAsync(10);

      const fresh = document.createElement("div");
      fresh.id = "fresh";
      fresh.className = "el-skeleton__item el-skeleton__image bot-image-item__skeleton";
      document.body.append(fresh);
      await vi.advanceTimersByTimeAsync(10);

      document.querySelector("#old")?.remove();
      await vi.advanceTimersByTimeAsync(10);
      expect(complete).not.toHaveBeenCalled();

      const downloadButton = document.createElement("button");
      const downloadClick = vi.fn();
      downloadButton.dataset.cy = "download-file-btn";
      downloadButton.addEventListener("click", downloadClick);
      document.body.append(downloadButton);
      fresh.remove();
      await vi.advanceTimersByTimeAsync(10);
      expect(complete).toHaveBeenCalledTimes(1);
      expect(downloadClick).toHaveBeenCalledTimes(1);
      expect(oldDownload).not.toHaveBeenCalled();
      expect(downloadResult).toHaveBeenCalledWith({ status: "started" });
    } finally {
      tracker.stop();
      vi.useRealTimers();
    }
  });

  it("reports idle only after all tracked skeletons disappear", async () => {
    vi.useFakeTimers();
    const tracker = new SkeletonTracker(document, { appearTimeoutMs: 100, disappearTimeoutMs: 1000, pollMs: 10 });

    try {
      const snapshot = tracker.capture();
      const idle = vi.fn();
      tracker.trackNext(snapshot, () => undefined, () => undefined, () => false);
      tracker.waitForIdle(idle);

      const skeleton = document.createElement("div");
      skeleton.className = "el-skeleton__item el-skeleton__image bot-image-item__skeleton";
      document.body.append(skeleton);
      await vi.advanceTimersByTimeAsync(20);

      expect(idle).not.toHaveBeenCalled();

      const downloadButton = document.createElement("button");
      downloadButton.dataset.cy = "download-file-btn";
      document.body.append(downloadButton);
      skeleton.remove();
      await vi.advanceTimersByTimeAsync(20);

      expect(idle).toHaveBeenCalledTimes(1);
    } finally {
      tracker.stop();
      vi.useRealTimers();
    }
  });

  it("reports an error when the generated message has no download button", async () => {
    vi.useFakeTimers();
    const tracker = new SkeletonTracker(document, {
      appearTimeoutMs: 100,
      disappearTimeoutMs: 1000,
      downloadTimeoutMs: 20,
      pollMs: 10
    });

    try {
      const snapshot = tracker.capture();
      const downloadResult = vi.fn();
      tracker.trackNext(snapshot, () => undefined, downloadResult, () => false);

      const skeleton = document.createElement("div");
      skeleton.className = "el-skeleton__item el-skeleton__image bot-image-item__skeleton";
      document.body.append(skeleton);
      await vi.advanceTimersByTimeAsync(10);

      skeleton.remove();
      await vi.advanceTimersByTimeAsync(40);

      expect(downloadResult).toHaveBeenCalledWith({ status: "error", message: "Image download button not found." });
    } finally {
      tracker.stop();
      vi.useRealTimers();
    }
  });

  it("downloads the image from the matching message when generations overlap", async () => {
    vi.useFakeTimers();
    const tracker = new SkeletonTracker(document, { appearTimeoutMs: 100, disappearTimeoutMs: 1000, pollMs: 10 });

    try {
      const firstMessage = document.createElement("section");
      const firstSkeleton = document.createElement("div");
      firstSkeleton.className = "el-skeleton__item el-skeleton__image bot-image-item__skeleton";
      firstMessage.append(firstSkeleton);

      const firstSnapshot = tracker.capture();
      tracker.trackNext(firstSnapshot, () => undefined, () => undefined, () => false);
      document.body.append(firstMessage);
      await vi.advanceTimersByTimeAsync(10);

      const secondMessage = document.createElement("section");
      const secondSkeleton = document.createElement("div");
      secondSkeleton.className = "el-skeleton__item el-skeleton__image bot-image-item__skeleton";
      secondMessage.append(secondSkeleton);

      const secondSnapshot = tracker.capture();
      tracker.trackNext(secondSnapshot, () => undefined, () => undefined, () => false);
      document.body.append(secondMessage);
      await vi.advanceTimersByTimeAsync(10);

      const firstDownload = document.createElement("button");
      const secondDownload = document.createElement("button");
      const firstClick = vi.fn();
      const secondClick = vi.fn();
      firstDownload.dataset.cy = "download-file-btn";
      secondDownload.dataset.cy = "download-file-btn";
      firstDownload.addEventListener("click", firstClick);
      secondDownload.addEventListener("click", secondClick);
      firstMessage.append(firstDownload);
      secondMessage.append(secondDownload);

      secondSkeleton.remove();
      await vi.advanceTimersByTimeAsync(10);
      expect(secondClick).toHaveBeenCalledTimes(1);
      expect(firstClick).not.toHaveBeenCalled();

      firstSkeleton.remove();
      await vi.advanceTimersByTimeAsync(10);
      expect(firstClick).toHaveBeenCalledTimes(1);
    } finally {
      tracker.stop();
      vi.useRealTimers();
    }
  });

  it("clicks a download button that becomes enabled after generation", async () => {
    vi.useFakeTimers();
    const tracker = new SkeletonTracker(document, { appearTimeoutMs: 100, disappearTimeoutMs: 1000, pollMs: 10 });

    try {
      const message = document.createElement("section");
      const skeleton = document.createElement("div");
      const downloadButton = document.createElement("button");
      const downloadClick = vi.fn();
      skeleton.className = "el-skeleton__item el-skeleton__image bot-image-item__skeleton";
      downloadButton.dataset.cy = "download-file-btn";
      downloadButton.disabled = true;
      downloadButton.addEventListener("click", downloadClick);
      message.append(downloadButton);
      document.body.append(message);

      const snapshot = tracker.capture();
      tracker.trackNext(snapshot, () => undefined, () => undefined, () => false);
      message.prepend(skeleton);
      await vi.advanceTimersByTimeAsync(10);

      downloadButton.disabled = false;
      skeleton.remove();
      await vi.advanceTimersByTimeAsync(10);

      expect(downloadClick).toHaveBeenCalledTimes(1);
    } finally {
      tracker.stop();
      vi.useRealTimers();
    }
  });
});
