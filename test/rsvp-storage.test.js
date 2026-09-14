import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openRsvpStorage } from "../server/storage.js";

const VOTE_ID = "15b6ad49-309a-4a72-a182-6f374f452a16";

function temporaryStorage(testContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shum-rsvp-test-"));
  const storage = openRsvpStorage(path.join(directory, "rsvp.sqlite"));
  testContext.after(() => {
    storage.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return storage;
}

test("a repeated voteId increments the aggregate exactly once", (testContext) => {
  const storage = temporaryStorage(testContext);

  assert.deepEqual(storage.recordVote(VOTE_ID), { counted: true });
  assert.deepEqual(storage.recordVote(VOTE_ID), { counted: false });
  assert.equal(storage.getCount(), 1);
});

test("parallel calls with one voteId are idempotent", async (testContext) => {
  const storage = temporaryStorage(testContext);
  const results = await Promise.all(
    Array.from({ length: 10 }, () => Promise.resolve().then(() => storage.recordVote(VOTE_ID))),
  );

  assert.equal(results.filter((result) => result.counted).length, 1);
  assert.equal(storage.getCount(), 1);
});

test("an organizer notification can be claimed only once", (testContext) => {
  const storage = temporaryStorage(testContext);
  storage.recordVote(VOTE_ID);

  assert.equal(storage.claimNotification(VOTE_ID), true);
  assert.equal(storage.claimNotification(VOTE_ID), false);
});

test("finalization deletes attempt IDs but preserves the aggregate", (testContext) => {
  const storage = temporaryStorage(testContext);
  storage.recordVote(VOTE_ID);

  assert.equal(storage.finalizeEvent(), 1);
  assert.equal(storage.getCount(), 1);
  assert.equal(storage.claimNotification(VOTE_ID), false);
});
