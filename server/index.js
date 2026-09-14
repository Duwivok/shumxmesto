import http from "node:http";
import { loadConfig } from "./config.js";
import { createRequestHandler } from "./request-handler.js";
import { openRsvpStorage } from "./storage.js";
import { createTelegramCommandPoller, createTelegramNotifier } from "./telegram.js";

let config;
try {
  config = loadConfig();
} catch {
  console.error("Server configuration is incomplete or invalid");
  process.exit(1);
}

const storage = openRsvpStorage(config.databasePath);
const notifier = createTelegramNotifier({
  botToken: config.telegramBotToken,
  organizerChatId: config.telegramOrganizerChatId,
});
const commandPoller = createTelegramCommandPoller({
  botToken: config.telegramBotToken,
  organizerChatId: config.telegramOrganizerChatId,
  setGeoHidden: (hidden) => storage.setGeoHidden(hidden),
  getTelegramOffset: () => storage.getTelegramOffset(),
  setTelegramOffset: (offset) => storage.setTelegramOffset(offset),
});
const handler = createRequestHandler({
  staticRoot: config.staticRoot,
  publicOrigin: config.publicOrigin,
  rsvpOpen: config.rsvpOpen,
  globalLimitPerMinute: config.globalLimitPerMinute,
  storage,
  notifier,
});
const server = http.createServer(handler);

server.requestTimeout = 10_000;
server.headersTimeout = 5_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 100;

server.listen(config.port, config.host, () => {
  console.log(`SHUM server listening on ${config.host}:${config.port}`);
  commandPoller.start();
});

function shutdown() {
  commandPoller.stop();
  server.close(() => {
    storage.close();
    process.exit(0);
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
