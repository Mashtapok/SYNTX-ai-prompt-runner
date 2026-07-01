import type { BackgroundRequest, BackgroundResponse, ExtensionNotification } from "../shared/types";

export async function notifyRunCompleted(sceneCount: number): Promise<void> {
  await showNotification({
    id: `run-completed-${Date.now()}`,
    title: "SynteX Runner",
    message: completedScenesMessage(sceneCount),
    requireInteraction: true
  });
}

export async function notifyRateLimit(sceneNumber: number): Promise<void> {
  await showNotification({
    id: `rate-limit-${sceneNumber}-${Date.now()}`,
    title: "SynteX: ошибка 429",
    message: `Ошибка на сцене ${sceneNumber}. Генерация будет повторена.`,
    requireInteraction: true
  });
}

export async function notifyGenerationError(sceneNumber: number): Promise<void> {
  await showNotification({
    id: `generation-error-${sceneNumber}-${Date.now()}`,
    title: "SynteX: ошибка генерации",
    message: `Ошибка генерации на сцене ${sceneNumber}. Промпт будет отправлен заново.`,
    requireInteraction: true
  });
}

function completedScenesMessage(sceneCount: number): string {
  const lastTwo = sceneCount % 100;
  const last = sceneCount % 10;

  if (lastTwo < 11 || lastTwo > 14) {
    if (last === 1) {
      return `${sceneCount} сцена завершена.`;
    }

    if (last >= 2 && last <= 4) {
      return `${sceneCount} сцены завершены.`;
    }
  }

  return `${sceneCount} сцен завершены.`;
}

async function showNotification(notification: ExtensionNotification): Promise<void> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: "SHOW_NOTIFICATION",
      notification
    } satisfies BackgroundRequest)) as BackgroundResponse<string> | undefined;

    if (!response?.ok) {
      console.warn("[SynteX Runner] Unable to show notification", response?.error);
      return;
    }

    console.log("[SynteX Runner] Notification created", response.data);
  } catch (error) {
    console.warn("[SynteX Runner] Unable to show notification", error);
  }
}
