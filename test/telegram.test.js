import test from "node:test";
import assert from "node:assert/strict";
import { createTelegramNotifier } from "../server/telegram.js";

test("the group notification contains only its destination and +1", async () => {
  let captured;
  const notifier = createTelegramNotifier({
    botToken: "server-only-test-token",
    groupChatId: "-1001234567890",
    fetchRequest: async (url, options) => {
      captured = { url, options };
      return {
        ok: true,
        json: async () => ({ ok: true }),
      };
    },
  });

  await notifier.sendPlusOne();
  assert.equal(
    captured.url,
    "https://api.telegram.org/botserver-only-test-token/sendMessage",
  );
  assert.deepEqual(JSON.parse(captured.options.body), {
    chat_id: "-1001234567890",
    text: "+1",
    disable_notification: false,
    protect_content: true,
  });
});
