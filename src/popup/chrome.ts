import type { ExtensionRequest, ExtensionResponse } from "../shared/types";

export async function sendToActiveTab<T>(message: ExtensionRequest): Promise<T> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    throw new Error("Open SynteX page first.");
  }

  if (tab.url && !isSyntexUrl(tab.url)) {
    throw new Error("Open SynteX page first.");
  }

  try {
    return await sendMessage<T>(tab.id, message);
  } catch (error) {
    if (!isMissingReceiverError(error)) {
      throw new Error(toErrorMessage(error));
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["assets/content.js"]
      });
      return await sendMessage<T>(tab.id, message);
    } catch (injectError) {
      throw new Error(
        isMissingReceiverError(injectError)
          ? "Reload SynteX page and try again."
          : toErrorMessage(injectError)
      );
    }
  }
}

async function sendMessage<T>(tabId: number, message: ExtensionRequest): Promise<T> {
  const response = (await chrome.tabs.sendMessage(tabId, message)) as ExtensionResponse<T>;

  if (!response.ok) {
    throw new Error(response.error);
  }

  return response.data;
}

export function isSyntexUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && (parsed.hostname === "syntx.ai" || parsed.hostname.endsWith(".syntx.ai"));
  } catch {
    return false;
  }
}

export function isMissingReceiverError(error: unknown): boolean {
  return toErrorMessage(error).includes("Receiving end does not exist");
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Unable to connect to SynteX page.";
}
