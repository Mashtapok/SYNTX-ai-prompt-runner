import type { BackgroundRequest, BackgroundResponse, RateLimitSignal } from "../shared/types";

const SYNTX_URLS = ["https://syntx.ai/*", "https://*.syntx.ai/*"];
const RATE_LIMIT_TTL_MS = 5 * 60 * 1000;
const DOWNLOAD_NAME_TTL_MS = 5 * 60 * 1000;

const recentRateLimits = new Map<number, RateLimitSignal>();
const pendingDownloadNames: Array<{ sceneNumber: number; time: number }> = [];

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  pruneOldDownloadNames();
  const pending = pendingDownloadNames.shift();

  if (!pending) {
    suggest();
    return;
  }

  const ext = extractExtension(item.filename) || "png";
  const filename = `scena-${pending.sceneNumber}.${ext}`;
  console.log("[SynteX Runner] Renaming download", { from: item.filename, to: filename });
  suggest({ filename, conflictAction: "uniquify" });
});

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0 || details.statusCode !== 429) {
      return;
    }

    const signal: RateLimitSignal = {
      statusCode: 429,
      url: details.url,
      time: Date.now()
    };

    recentRateLimits.set(details.tabId, signal);
    console.log("[SynteX Runner] 429 response detected", signal);
  },
  { urls: SYNTX_URLS }
);

chrome.tabs.onRemoved.addListener((tabId) => {
  recentRateLimits.delete(tabId);
});

chrome.runtime.onMessage.addListener((message: BackgroundRequest, sender, sendResponse) => {
  if (!isBackgroundRequest(message)) {
    return false;
  }

  if (message.type === "SHOW_NOTIFICATION") {
    showNotification(message.notification, sendResponse);
    return true;
  }

  if (message.type === "REGISTER_DOWNLOAD_NAME") {
    pruneOldDownloadNames();
    pendingDownloadNames.push({ sceneNumber: message.sceneNumber, time: Date.now() });
    sendResponse({ ok: true, data: null } satisfies BackgroundResponse<null>);
    return true;
  }

  const tabId = sender.tab?.id;

  if (typeof tabId !== "number") {
    sendResponse({ ok: false, error: "Unable to identify SynteX tab." } satisfies BackgroundResponse);
    return true;
  }

  pruneOldSignals();

  if (message.type === "CLEAR_RATE_LIMIT_SIGNAL") {
    recentRateLimits.delete(tabId);
    sendResponse({ ok: true, data: null } satisfies BackgroundResponse<null>);
    return true;
  }

  const signal = recentRateLimits.get(tabId);
  const since = message.since ?? 0;

  if (signal && signal.time >= since) {
    recentRateLimits.delete(tabId);
    sendResponse({ ok: true, data: signal } satisfies BackgroundResponse<RateLimitSignal>);
    return true;
  }

  sendResponse({ ok: true, data: null } satisfies BackgroundResponse<RateLimitSignal | null>);
  return true;
});

function showNotification(
  notification: Extract<BackgroundRequest, { type: "SHOW_NOTIFICATION" }>["notification"],
  sendResponse: (response: BackgroundResponse<string>) => void
): void {
  chrome.notifications.getPermissionLevel((level) => {
    const permissionError = chrome.runtime.lastError;

    if (permissionError) {
      const error = permissionError.message ?? "Unable to check notification permission.";
      console.warn("[SynteX Runner] Notification permission check failed", error);
      sendResponse({ ok: false, error });
      return;
    }

    console.log("[SynteX Runner] Notification permission", level);

    if (level !== "granted") {
      sendResponse({ ok: false, error: "Notifications are disabled in Chrome." });
      return;
    }

    chrome.notifications.create(
      notification.id,
      {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icon128.png"),
        title: notification.title,
        message: notification.message,
        requireInteraction: notification.requireInteraction ?? false
      },
      (notificationId) => {
        const createError = chrome.runtime.lastError;

        if (createError) {
          const error = createError.message ?? "Unable to show notification.";
          console.warn("[SynteX Runner] Notification creation failed", error);
          sendResponse({ ok: false, error });
          return;
        }

        console.log("[SynteX Runner] Notification created", notificationId);
        sendResponse({ ok: true, data: notificationId });
      }
    );
  });
}

function isBackgroundRequest(message: unknown): message is BackgroundRequest {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    (message.type === "CLEAR_RATE_LIMIT_SIGNAL" ||
      message.type === "TAKE_RATE_LIMIT_SIGNAL" ||
      message.type === "SHOW_NOTIFICATION" ||
      message.type === "REGISTER_DOWNLOAD_NAME")
  );
}

function pruneOldSignals(): void {
  const oldestAllowed = Date.now() - RATE_LIMIT_TTL_MS;

  for (const [tabId, signal] of recentRateLimits) {
    if (signal.time < oldestAllowed) {
      recentRateLimits.delete(tabId);
    }
  }
}

function pruneOldDownloadNames(): void {
  const oldestAllowed = Date.now() - DOWNLOAD_NAME_TTL_MS;

  while (pendingDownloadNames.length > 0 && pendingDownloadNames[0].time < oldestAllowed) {
    pendingDownloadNames.shift();
  }
}

function extractExtension(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");

  if (dot <= 0 || dot === base.length - 1) {
    return "";
  }

  return base.slice(dot + 1).toLowerCase();
}
