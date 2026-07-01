import type { BackgroundRequest, BackgroundResponse, RateLimitSignal } from "../shared/types";

export async function clearRateLimitSignal(): Promise<void> {
  try {
    await sendBackgroundMessage<null>({ type: "CLEAR_RATE_LIMIT_SIGNAL" });
  } catch (error) {
    console.warn("[SynteX Runner] Unable to clear 429 signal", error);
  }
}

export async function takeRateLimitSignal(since?: number): Promise<boolean> {
  try {
    const signal = await sendBackgroundMessage<RateLimitSignal | null>({ type: "TAKE_RATE_LIMIT_SIGNAL", since });
    return signal?.statusCode === 429;
  } catch (error) {
    console.warn("[SynteX Runner] Unable to read 429 signal", error);
    return false;
  }
}

export function watchRateLimitSignal(since: number, onDetected: () => void, pollMs = 500): () => void {
  let stopped = false;
  let checkInFlight = false;

  const check = async (): Promise<void> => {
    if (stopped || checkInFlight) {
      return;
    }

    checkInFlight = true;

    try {
      if (await takeRateLimitSignal(since)) {
        stopped = true;
        window.clearInterval(interval);
        onDetected();
      }
    } finally {
      checkInFlight = false;
    }
  };

  const interval = window.setInterval(() => void check(), pollMs);
  void check();

  return () => {
    stopped = true;
    window.clearInterval(interval);
  };
}

async function sendBackgroundMessage<T>(message: BackgroundRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as BackgroundResponse<T> | undefined;

  if (!response?.ok) {
    throw new Error(response?.error ?? "Unable to read network status.");
  }

  return response.data;
}
