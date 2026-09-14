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
