import test from "node:test";
import assert from "node:assert/strict";
import { createTelegramCommandPoller, createTelegramNotifier } from "../server/telegram.js";

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

test("organizer /hide and /show commands update the global geo state", async () => {
  const updates = [
    { update_id: 40, message: { chat: { id: 123 }, text: "/hide" } },
    { update_id: 41, message: { chat: { id: 123 }, text: "/show@test_bot" } },
    { update_id: 42, message: { chat: { id: 999 }, text: "/hide" } },
  ];
  const states = [];
  const offsets = [];
  const confirmations = [];
  let finishCommands;
  const commandsFinished = new Promise((resolve) => { finishCommands = resolve; });
  const poller = createTelegramCommandPoller({
    botToken: "server-only-test-token",
    organizerChatId: "123",
    getTelegramOffset: () => 40,
    setTelegramOffset: (offset) => offsets.push(offset),
    setGeoHidden(hidden) {
      states.push(hidden);
      if (states.length === 2) finishCommands();
    },
    fetchRequest: async (url, options) => {
      if (String(url).includes("getUpdates")) {
        if (updates.length) {
          return { ok: true, json: async () => ({ ok: true, result: updates.splice(0) }) };
        }
        return new Promise((resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(
            Object.assign(new Error("aborted"), { name: "AbortError" }),
          ));
        });
      }
      confirmations.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });

  poller.start();
  await commandsFinished;
  await new Promise((resolve) => setImmediate(resolve));
  poller.stop();

  assert.deepEqual(states, [true, false]);
  assert.deepEqual(offsets, [41, 42, 43]);
  assert.deepEqual(confirmations.map((item) => item.text), [
    "Раздел «Гео» скрыт.",
    "Раздел «Гео» открыт.",
  ]);
});
