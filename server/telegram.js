export function createTelegramNotifier({
  botToken,
  organizerChatId,
  fetchRequest = globalThis.fetch,
  timeoutMs = 5000,
}) {
  return Object.freeze({
    async sendPlusOne() {
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), timeoutMs);

      try {
        const response = await fetchRequest(
          `https://api.telegram.org/bot${botToken}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: organizerChatId,
              text: "+1",
              disable_notification: false,
              protect_content: true,
            }),
            signal: abortController.signal,
          },
        );
        const result = await response.json().catch(() => null);
        if (!response.ok || result?.ok !== true) {
          throw new Error("Telegram notification was not accepted");
        }
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}

function telegramCommand(text) {
  if (typeof text !== "string") {
    return null;
  }
  const match = text.trim().match(/^\/(hide|show)(?:@[a-z0-9_]+)?$/i);
  return match?.[1].toLowerCase() || null;
}

export function createTelegramCommandPoller({
  botToken,
  organizerChatId,
  setGeoHidden,
  getTelegramOffset = () => 0,
  setTelegramOffset = () => {},
  fetchRequest = globalThis.fetch,
  pollTimeoutSeconds = 25,
  retryDelayMs = 3000,
  confirmationTimeoutMs = 5000,
}) {
  let offset = getTelegramOffset();
  let stopped = true;
  let activeAbortController = null;
  let retryTimer = null;
  let resolveRetry = null;

  const apiUrl = (method) => `https://api.telegram.org/bot${botToken}/${method}`;

  async function sendConfirmation(chatId, hidden) {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), confirmationTimeoutMs);
    try {
      const response = await fetchRequest(apiUrl("sendMessage"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: hidden ? "Раздел «Гео» скрыт." : "Раздел «Гео» открыт.",
          disable_notification: true,
          protect_content: true,
        }),
        signal: abortController.signal,
      });
      if (!response.ok) {
        throw new Error("Telegram command confirmation was not accepted");
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  async function handleUpdate(update) {
    const message = update?.message;
    if (String(message?.chat?.id) !== String(organizerChatId)) {
      return;
    }
    const command = telegramCommand(message.text);
    if (!command) {
      return;
    }
    const hidden = command === "hide";
    setGeoHidden(hidden);
    try {
      await sendConfirmation(message.chat.id, hidden);
    } catch {
      console.error("Telegram command was applied, but confirmation failed");
    }
  }

  async function pollOnce() {
    activeAbortController = new AbortController();
    const url = new URL(apiUrl("getUpdates"));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("timeout", String(pollTimeoutSeconds));
    url.searchParams.set("allowed_updates", JSON.stringify(["message"]));
    const response = await fetchRequest(url, { signal: activeAbortController.signal });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.ok !== true || !Array.isArray(body.result)) {
      throw new Error("Telegram updates were not available");
    }
    for (const update of body.result) {
      await handleUpdate(update);
      if (Number.isSafeInteger(update?.update_id)) {
        offset = Math.max(offset, update.update_id + 1);
        setTelegramOffset(offset);
      }
    }
  }

  async function loop() {
    while (!stopped) {
      try {
        await pollOnce();
      } catch (error) {
        if (stopped || error?.name === "AbortError") {
          break;
        }
        console.error("Telegram command polling failed; retrying");
        await new Promise((resolve) => {
          resolveRetry = resolve;
          retryTimer = setTimeout(resolve, retryDelayMs);
        });
        retryTimer = null;
        resolveRetry = null;
      } finally {
        activeAbortController = null;
      }
    }
  }

  return Object.freeze({
    start() {
      if (!stopped) {
        return;
      }
      stopped = false;
      void loop();
    },
    stop() {
      stopped = true;
      activeAbortController?.abort();
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
        resolveRetry?.();
        resolveRetry = null;
      }
    },
  });
}
