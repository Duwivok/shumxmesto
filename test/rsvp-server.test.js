import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createRequestHandler } from "../server/request-handler.js";
import { openRsvpStorage } from "../server/storage.js";

const PUBLIC_ORIGIN = "https://shum.example";
const VOTE_ID = "15b6ad49-309a-4a72-a182-6f374f452a16";
const OTHER_VOTE_ID = "5d25ece4-49bd-49f8-8755-1c4028ebfe5f";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function serverFixture(testContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shum-server-test-"));
  const storage = openRsvpStorage(path.join(directory, "rsvp.sqlite"));
  let notifications = 0;
  const handler = createRequestHandler({
    staticRoot: path.join(projectRoot, "site"),
    publicOrigin: PUBLIC_ORIGIN,
    rsvpOpen: true,
    globalLimitPerMinute: 100,
    storage,
    notifier: {
      async sendPlusOne() {
        notifications += 1;
      },
    },
  });
  const server = http.createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  testContext.after(async () => {
    server.close();
    await once(server, "close");
    storage.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { baseUrl, storage, notifications: () => notifications };
}

function postVote(baseUrl, body, headers = {}) {
  return fetch(`${baseUrl}/api/rsvp`, {
    method: "POST",
    headers: {
      Origin: PUBLIC_ORIGIN,
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test("the endpoint counts and notifies only for a new voteId", async (testContext) => {
  const fixture = await serverFixture(testContext);
  const first = await postVote(fixture.baseUrl, { voteId: VOTE_ID });
  const second = await postVote(fixture.baseUrl, { voteId: VOTE_ID });

  assert.deepEqual(await first.json(), { ok: true, counted: true });
  assert.deepEqual(await second.json(), { ok: true, counted: false });
  assert.equal(fixture.storage.getCount(), 1);
  assert.equal(fixture.notifications(), 1);
  assert.equal(first.headers.get("set-cookie"), null);
  assert.equal(first.headers.get("cache-control"), "no-store");
});

test("two parallel requests with one voteId count and notify once", async (testContext) => {
  const fixture = await serverFixture(testContext);
  const responses = await Promise.all(
    Array.from({ length: 8 }, () => postVote(fixture.baseUrl, { voteId: OTHER_VOTE_ID })),
  );
  const results = await Promise.all(responses.map((response) => response.json()));

  assert.equal(results.filter((result) => result.counted).length, 1);
  assert.equal(fixture.storage.getCount(), 1);
  assert.equal(fixture.notifications(), 1);
});

test("invalid IDs, extra user fields, and foreign origins are rejected", async (testContext) => {
  const fixture = await serverFixture(testContext);
  const invalid = await postVote(fixture.baseUrl, { voteId: "too-long-or-invalid" });
  const extra = await postVote(fixture.baseUrl, { voteId: VOTE_ID, initData: "forbidden" });
  const foreign = await postVote(
    fixture.baseUrl,
    { voteId: VOTE_ID },
    { Origin: "https://foreign.example" },
  );

  assert.equal(invalid.status, 400);
  assert.equal(extra.status, 400);
  assert.equal(foreign.status, 403);
  assert.equal(fixture.storage.getCount(), 0);
  assert.equal(fixture.notifications(), 0);
});

test("the endpoint accepts only POST with JSON and a bounded body", async (testContext) => {
  const fixture = await serverFixture(testContext);
  const getResponse = await fetch(`${fixture.baseUrl}/api/rsvp`);
  const wrongType = await fetch(`${fixture.baseUrl}/api/rsvp`, {
    method: "POST",
    headers: { Origin: PUBLIC_ORIGIN, "Content-Type": "text/plain" },
    body: "test",
  });
  const oversized = await postVote(fixture.baseUrl, { voteId: "x".repeat(300) });

  assert.equal(getResponse.status, 405);
  assert.equal(wrongType.status, 415);
  assert.equal(oversized.status, 413);
});

test("an ambiguous Telegram failure never recounts or retries the notification", async (testContext) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shum-notifier-test-"));
  const storage = openRsvpStorage(path.join(directory, "rsvp.sqlite"));
  let notificationAttempts = 0;
  const handler = createRequestHandler({
    staticRoot: path.join(projectRoot, "site"),
    publicOrigin: PUBLIC_ORIGIN,
    rsvpOpen: true,
    globalLimitPerMinute: 100,
    storage,
    notifier: {
      async sendPlusOne() {
        notificationAttempts += 1;
        throw new Error("ambiguous failure");
      },
    },
  });
  const server = http.createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  testContext.after(async () => {
    server.close();
    await once(server, "close");
    storage.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const first = await postVote(baseUrl, { voteId: VOTE_ID });
  const retry = await postVote(baseUrl, { voteId: VOTE_ID });

  assert.deepEqual(await first.json(), { ok: true, counted: true });
  assert.deepEqual(await retry.json(), { ok: true, counted: false });
  assert.equal(storage.getCount(), 1);
  assert.equal(notificationAttempts, 1);
});

test("the same server serves the frontend without cookies", async (testContext) => {
  const fixture = await serverFixture(testContext);
  const response = await fetch(`${fixture.baseUrl}/`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.match(html, /data-cigarette/);
});

test("the geo state is global, persistent, and served without caching", async (testContext) => {
  const fixture = await serverFixture(testContext);
  const initiallyHidden = await fetch(`${fixture.baseUrl}/api/geo-state`);
  assert.deepEqual(await initiallyHidden.json(), { hidden: true });
  assert.equal(initiallyHidden.headers.get("cache-control"), "no-store");

  fixture.storage.setGeoHidden(false);
  const shown = await fetch(`${fixture.baseUrl}/api/geo-state`);
  assert.deepEqual(await shown.json(), { hidden: false });
});

test("the public client does not contain Telegram secrets or profile access", () => {
  const clientSource = fs.readFileSync(path.join(projectRoot, "site", "app.js"), "utf8")
    + fs.readFileSync(path.join(projectRoot, "site", "rsvp.js"), "utf8")
    + fs.readFileSync(path.join(projectRoot, "site", "rsvp-config.js"), "utf8")
    + fs.readFileSync(path.join(projectRoot, "site", "index.html"), "utf8");

  assert.doesNotMatch(clientSource, /TELEGRAM_BOT_TOKEN|initDataUnsafe|initData/);
  assert.doesNotMatch(clientSource, /navigator\.userAgent/);
});
