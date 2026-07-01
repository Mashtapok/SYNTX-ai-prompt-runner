import { describe, expect, it } from "vitest";
import { isMissingReceiverError, isSyntexUrl } from "../src/popup/chrome";

describe("popup chrome helpers", () => {
  it("accepts SynteX hosts only", () => {
    expect(isSyntexUrl("https://syntx.ai/ru/image")).toBe(true);
    expect(isSyntexUrl("https://app.syntx.ai/image")).toBe(true);
    expect(isSyntexUrl("https://example.com")).toBe(false);
    expect(isSyntexUrl("chrome://extensions")).toBe(false);
  });

  it("detects missing content script receiver", () => {
    expect(isMissingReceiverError(new Error("Could not establish connection. Receiving end does not exist."))).toBe(true);
    expect(isMissingReceiverError(new Error("Prompt field not found."))).toBe(false);
  });
});
