import { loadConfig } from "../config.js";
import { openRsvpStorage } from "../storage.js";

const config = loadConfig(process.env, { requireTelegram: false });
if (config.rsvpOpen || process.env.CONFIRM_FINALIZE !== "YES") {
  console.error("Set RSVP_OPEN=false and CONFIRM_FINALIZE=YES before finalizing the event");
  process.exit(1);
}

const storage = openRsvpStorage(config.databasePath);
const total = storage.finalizeEvent();
storage.close();
console.log(`Random RSVP attempt IDs removed; aggregate total preserved: ${total}`);
