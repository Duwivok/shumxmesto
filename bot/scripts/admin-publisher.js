import {
  AdminPostError,
  buildAdminPost,
  isAuthorizedAdminMessage,
} from "../admin-post.js";
import { parseGeoCommand } from "../geo-command.js";
import { openRsvpStorage } from "../../server/storage.js";

const ALBUM_SETTLE_MS = 1200;
const RETRY_DELAY_MS = 3000;

function required(environment, name, pattern) {
  const value = environment[name]?.trim();
  if (!value || (pattern && !pattern.test(value))) {
    throw new Error(`${name} is missing or invalid`);
  }
  return value;
}

const botToken = required(process.env, "TELEGRAM_BOT_TOKEN");
const groupChatId = required(process.env, "TELEGRAM_GROUP_CHAT_ID", /^-\d+$/);
const adminUserId = required(process.env, "TELEGRAM_ADMIN_USER_ID", /^\d+$/);
const databasePath = required(process.env, "RSVP_DB_PATH");

class TelegramApi {
  constructor(token) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
    this.controllers = new Set();
  }

  async call(method, body = {}, timeoutMs = 12_000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    this.controllers.add(controller);
    try {
      const response = await fetch(`${this.baseUrl}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.ok !== true) {
        const description = result?.description || `HTTP ${response.status}`;
        throw new Error(`${method}: ${description}`);
      }
      return result.result;
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(controller);
    }
  }

  abortAll() {
    for (const controller of this.controllers) controller.abort();
  }
}

const telegram = new TelegramApi(botToken);
const bot = await telegram.call("getMe");
if (!bot?.username) {
  throw new Error("The bot has no username; the Mini App launch URL cannot be built");
}
const buttonUrl = `https://t.me/${bot.username}?startapp=home`;
const authorization = { adminUserId, groupChatId };
const storage = openRsvpStorage(databasePath);
const pendingAlbums = new Map();
const activeTasks = new Set();
let nextUpdateId;
let stopping = false;
let shutdownPromise;

function rememberTask(task) {
  activeTasks.add(task);
  void task.then(
    () => activeTasks.delete(task),
    () => activeTasks.delete(task),
  );
  return task;
}

async function sendAdminError(message, error) {
  const text = error instanceof AdminPostError
    ? `Публикация не создана: ${error.message}`
    : "Публикация не создана из-за ошибки Telegram. Подробности записаны в журнал сервиса.";
  await telegram.call("sendMessage", {
    chat_id: groupChatId,
    text,
    disable_notification: true,
    reply_parameters: {
      message_id: message.message_id,
      allow_sending_without_reply: true,
    },
    ...(message.message_thread_id ? { message_thread_id: message.message_thread_id } : {}),
  });
}

async function publishMessages(messages) {
  const ordered = [...messages].sort((left, right) => left.message_id - right.message_id);
  const first = ordered[0];
  try {
    const richMessage = buildAdminPost(ordered, buttonUrl);
    await telegram.call("sendRichMessage", {
      chat_id: groupChatId,
      rich_message: richMessage,
      ...(first.message_thread_id ? { message_thread_id: first.message_thread_id } : {}),
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    try {
      await sendAdminError(first, error);
    } catch (notificationError) {
      console.error(notificationError instanceof Error ? notificationError.message : notificationError);
    }
  }
}

function queueAlbum(message) {
  const key = message.media_group_id;
  const existing = pendingAlbums.get(key) || { messages: [], timeout: null };
  existing.messages.push(message);
  clearTimeout(existing.timeout);
  existing.timeout = setTimeout(() => {
    pendingAlbums.delete(key);
    rememberTask(publishMessages(existing.messages));
  }, ALBUM_SETTLE_MS);
  pendingAlbums.set(key, existing);
}

async function handleUpdate(update) {
  const message = update.message;
  if (!isAuthorizedAdminMessage(message, authorization)) {
    return;
  }
  const geoCommand = parseGeoCommand(message.text);
  if (geoCommand) {
    const hidden = geoCommand === "hide";
    storage.setGeoHidden(hidden);
    try {
      await telegram.call("sendMessage", {
        chat_id: groupChatId,
        text: hidden ? "Раздел «Гео» скрыт." : "Раздел «Гео» открыт.",
        disable_notification: true,
        protect_content: true,
        reply_parameters: {
          message_id: message.message_id,
          allow_sending_without_reply: true,
        },
        ...(message.message_thread_id ? { message_thread_id: message.message_thread_id } : {}),
      });
    } catch (error) {
      console.error("Geo state changed, but its Telegram confirmation failed", error);
    }
    return;
  }
  if (message.media_group_id) {
    queueAlbum(message);
    return;
  }
  await publishMessages([message]);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function shutdown() {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    stopping = true;
    telegram.abortAll();
    for (const album of pendingAlbums.values()) {
      clearTimeout(album.timeout);
      rememberTask(publishMessages(album.messages));
    }
    pendingAlbums.clear();
    await Promise.allSettled(activeTasks);
    storage.close();
  })();
  return shutdownPromise;
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

console.log(`Admin publisher @${bot.username} is listening in group ${groupChatId}`);

while (!stopping) {
  try {
    const updates = await telegram.call("getUpdates", {
      ...(nextUpdateId === undefined ? {} : { offset: nextUpdateId }),
      timeout: 30,
      limit: 100,
      allowed_updates: ["message"],
    }, 40_000);
    for (const update of updates) {
      nextUpdateId = update.update_id + 1;
      await handleUpdate(update);
    }
  } catch (error) {
    if (stopping && error?.name === "AbortError") break;
    console.error(error instanceof Error ? error.message : error);
    await delay(RETRY_DELAY_MS);
  }
}

await shutdown();
