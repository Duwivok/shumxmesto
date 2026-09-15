import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function positiveInteger(value, fallback, name) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function required(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function normalizedOrigin(value) {
  const url = new URL(value);
  const isLocalHttp = url.protocol === "http:"
    && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (url.protocol !== "https:" && !isLocalHttp) {
    throw new Error("PUBLIC_ORIGIN must use HTTPS outside local development");
  }
  return url.origin;
}

export function loadConfig(environment = process.env, { requireTelegram = true } = {}) {
  const isProduction = environment.NODE_ENV === "production";
  const publicOriginValue = isProduction
    ? required(environment.PUBLIC_ORIGIN, "PUBLIC_ORIGIN")
    : environment.PUBLIC_ORIGIN || "http://127.0.0.1:3000";

  return Object.freeze({
    host: environment.HOST || "127.0.0.1",
    port: positiveInteger(environment.PORT, 3000, "PORT"),
    publicOrigin: normalizedOrigin(publicOriginValue),
    staticRoot: path.join(projectRoot, "site"),
    databasePath: path.resolve(environment.RSVP_DB_PATH || path.join(projectRoot, "data", "rsvp.sqlite")),
    rsvpOpen: environment.RSVP_OPEN !== "false",
    globalLimitPerMinute: positiveInteger(
      environment.RSVP_GLOBAL_LIMIT_PER_MINUTE,
      300,
      "RSVP_GLOBAL_LIMIT_PER_MINUTE",
    ),
    telegramBotToken: requireTelegram
      ? required(environment.TELEGRAM_BOT_TOKEN, "TELEGRAM_BOT_TOKEN")
      : "",
    telegramGroupChatId: requireTelegram
      ? required(environment.TELEGRAM_GROUP_CHAT_ID, "TELEGRAM_GROUP_CHAT_ID")
      : "",
  });
}
