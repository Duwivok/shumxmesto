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
