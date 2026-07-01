import { beforeEach, describe, expect, it, vi } from "vitest";
import { startLearning } from "../src/content/learning";
import { loadLearningSelectors, MemoryStorageArea } from "../src/shared/storage";
import type { LearningSelectors } from "../src/shared/types";

describe("learning mode", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.getElementById("syntx-prompt-runner-learning")?.remove();
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

  it("captures prompt and generate clicks and stores selectors", async () => {
    document.body.innerHTML = `
      <textarea id="prompt-input"></textarea>
      <button id="generate-button">Generate</button>
    `;
    const area = new MemoryStorageArea();
    const saved: Array<LearningSelectors | null> = [];

    const result = await startLearning(area, (selectors) => saved.push(selectors));

    expect(result.message).toBe("Click Prompt field on the SynteX page.");

    click("#prompt-input");

    await vi.waitFor(async () => {
      expect((await loadLearningSelectors(area))?.promptSelector).toBe("#prompt-input");
    });

    click("#generate-button");

    await vi.waitFor(async () => {
      expect(await loadLearningSelectors(area)).toMatchObject({
        promptSelector: "#prompt-input",
        generateSelector: "#generate-button"
      });
    });
    expect(saved.at(-1)).toMatchObject({
      promptSelector: "#prompt-input",
      generateSelector: "#generate-button"
    });
  });

  it("logs clicked and saved selectors while learning", async () => {
    document.body.innerHTML = `
      <textarea id="prompt-input"></textarea>
      <button id="generate-button">
        <svg viewBox="0 0 16 16"><path d="M1 1 L15 8 L1 15" /></svg>
      </button>
    `;
    const area = new MemoryStorageArea();
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await startLearning(area, () => undefined);
    click("#prompt-input");

    await vi.waitFor(async () => {
      expect((await loadLearningSelectors(area))?.promptSelector).toBe("#prompt-input");
    });

    click("path");

    await vi.waitFor(async () => {
      expect(await loadLearningSelectors(area)).toMatchObject({
        promptSelector: "#prompt-input",
        generateSelector: "#generate-button"
      });
    });

    expect(consoleLog).toHaveBeenCalledWith(
      "[SynteX Runner] Learning click saved",
      expect.objectContaining({
        step: "Prompt field",
        clickedSelector: expect.stringContaining("textarea#prompt-input"),
        savedSelector: "#prompt-input"
      })
    );
    expect(consoleLog).toHaveBeenCalledWith(
      "[SynteX Runner] Learning click saved",
      expect.objectContaining({
        step: "Generate button",
        clickedSelector: expect.stringContaining("path"),
        savedSelector: "#generate-button"
      })
    );
  });
});

function click(selector: string): void {
  document.querySelector(selector)?.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true
    })
  );
}
