import test from "node:test";
import assert from "node:assert/strict";
import { createTelegramNotifier } from "../server/telegram.js";

test("the organizer notification contains only its destination and +1", async () => {
  let captured;
  const notifier = createTelegramNotifier({
    botToken: "server-only-test-token",
    organizerChatId: "organizer-chat",
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
    chat_id: "organizer-chat",
    text: "+1",
    disable_notification: false,
    protect_content: true,
  });
});
