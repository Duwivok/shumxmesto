import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openRsvpStorage(databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);

  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS rsvp_counter (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      total INTEGER NOT NULL CHECK (total >= 0)
    ) STRICT;

    INSERT OR IGNORE INTO rsvp_counter (singleton, total) VALUES (1, 0);

    CREATE TABLE IF NOT EXISTS rsvp_votes (
      vote_id TEXT PRIMARY KEY CHECK (length(vote_id) = 36),
      notification_claimed INTEGER NOT NULL DEFAULT 0
        CHECK (notification_claimed IN (0, 1))
    ) STRICT, WITHOUT ROWID;

    CREATE TABLE IF NOT EXISTS app_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      geo_hidden INTEGER NOT NULL CHECK (geo_hidden IN (0, 1))
    ) STRICT;

    INSERT OR IGNORE INTO app_state (singleton, geo_hidden) VALUES (1, 1);

    CREATE TABLE IF NOT EXISTS telegram_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      next_update_id INTEGER NOT NULL CHECK (next_update_id >= 0)
    ) STRICT;

    INSERT OR IGNORE INTO telegram_state (singleton, next_update_id) VALUES (1, 0);
  `);

  const insertVote = database.prepare(
    "INSERT OR IGNORE INTO rsvp_votes (vote_id) VALUES (?)",
  );
  const incrementCounter = database.prepare(
    "UPDATE rsvp_counter SET total = total + 1 WHERE singleton = 1",
  );
  const readCounter = database.prepare(
    "SELECT total FROM rsvp_counter WHERE singleton = 1",
  );
  const claimNotification = database.prepare(`
    UPDATE rsvp_votes
    SET notification_claimed = 1
    WHERE vote_id = ? AND notification_claimed = 0
  `);
  const readGeoState = database.prepare(
    "SELECT geo_hidden FROM app_state WHERE singleton = 1",
  );
  const updateGeoState = database.prepare(
    "UPDATE app_state SET geo_hidden = ? WHERE singleton = 1",
  );
  const readTelegramOffset = database.prepare(
    "SELECT next_update_id FROM telegram_state WHERE singleton = 1",
  );
  const updateTelegramOffset = database.prepare(
    "UPDATE telegram_state SET next_update_id = ? WHERE singleton = 1",
  );

  function recordVote(voteId) {
    database.exec("BEGIN IMMEDIATE");
    try {
      const insertion = insertVote.run(voteId);
      const counted = insertion.changes === 1;
      if (counted) {
        incrementCounter.run();
      }
      database.exec("COMMIT");
      return { counted };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  return Object.freeze({
    recordVote,
    claimNotification(voteId) {
      return claimNotification.run(voteId).changes === 1;
    },
    getCount() {
      return readCounter.get().total;
    },
    isGeoHidden() {
      return readGeoState.get().geo_hidden === 1;
    },
    setGeoHidden(hidden) {
      updateGeoState.run(hidden ? 1 : 0);
      return hidden;
    },
    getTelegramOffset() {
      return readTelegramOffset.get().next_update_id;
    },
    setTelegramOffset(nextUpdateId) {
      updateTelegramOffset.run(nextUpdateId);
    },
    finalizeEvent() {
      database.exec("BEGIN IMMEDIATE");
      let transactionOpen = true;
      try {
        const total = readCounter.get().total;
        database.exec("DELETE FROM rsvp_votes");
        database.exec("COMMIT");
        transactionOpen = false;
        database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        database.exec("VACUUM");
        database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        return total;
      } catch (error) {
        if (transactionOpen) {
          database.exec("ROLLBACK");
        }
        throw error;
      }
    },
    close() {
      database.close();
    },
  });
}
