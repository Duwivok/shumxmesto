import test from "node:test";
import assert from "node:assert/strict";
import { createRsvpController } from "../site/rsvp.js";

const VOTE_ID = "15b6ad49-309a-4a72-a182-6f374f452a16";
const OTHER_VOTE_ID = "5d25ece4-49bd-49f8-8755-1c4028ebfe5f";
const CHANNEL_URL = "https://t.me/example_channel";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function successfulResponse(counted = true) {
  return {
    ok: true,
    json: async () => ({ ok: true, counted }),
  };
}

function setup(overrides = {}) {
  const storage = overrides.storage || memoryStorage();
  const requests = [];
  const opened = [];
  let animationCount = 0;
  const controller = createRsvpController({
    endpoint: "/api/rsvp",
    storageKey: "shum:rsvp:test-event:v1",
    channelUrl: CHANNEL_URL,
    getStorage: () => storage,
    fetchRequest: async (url, options) => {
      requests.push({ url, options });
      return successfulResponse(requests.length === 1);
    },
    cryptoProvider: { randomUUID: () => VOTE_ID },
    playAnimation: async () => {
      animationCount += 1;
    },
    openChannel: (url) => opened.push(url),
    requestTimeoutMs: 100,
    ...overrides,
  });
  return { controller, storage, requests, opened, animationCount: () => animationCount };
}

test("first activation sends one anonymous request and confirms local state", async () => {
  const context = setup();
  const result = await context.controller.activate();

  assert.deepEqual(result, { ok: true, counted: true });
  assert.equal(context.requests.length, 1);
  assert.deepEqual(JSON.parse(context.requests[0].options.body), { voteId: VOTE_ID });
  assert.equal(context.requests[0].options.credentials, "omit");
  assert.equal(context.requests[0].options.referrerPolicy, "no-referrer");
  assert.deepEqual(context.controller.readState(), {
    version: 1,
    status: "confirmed",
    voteId: VOTE_ID,
  });
  assert.deepEqual(context.opened, [CHANNEL_URL]);
});

test("second activation opens the channel without another request", async () => {
  const context = setup();
  await context.controller.activate();
  await context.controller.activate();

  assert.equal(context.requests.length, 1);
  assert.equal(context.animationCount(), 2);
  assert.deepEqual(context.opened, [CHANNEL_URL, CHANNEL_URL]);
});

test("a fast double activation shares one in-flight operation", async () => {
  let releaseRequest;
  const requestGate = new Promise((resolve) => {
    releaseRequest = resolve;
  });
  let requestCount = 0;
  let animationCount = 0;
  let openCount = 0;
  const controller = createRsvpController({
    endpoint: "/api/rsvp",
    storageKey: "shum:rsvp:test-event:v1",
    channelUrl: CHANNEL_URL,
    getStorage: memoryStorage,
    fetchRequest: async () => {
      requestCount += 1;
      await requestGate;
      return successfulResponse();
    },
    cryptoProvider: { randomUUID: () => VOTE_ID },
    playAnimation: async () => {
      animationCount += 1;
    },
    openChannel: () => {
      openCount += 1;
    },
    requestTimeoutMs: 100,
  });

  const first = controller.activate();
  const second = controller.activate();
  releaseRequest();
  await Promise.all([first, second]);

  assert.equal(requestCount, 1);
  assert.equal(animationCount, 1);
  assert.equal(openCount, 1);
});

test("a retry after network failure reuses the same voteId", async () => {
  const bodies = [];
  let attempt = 0;
  const context = setup({
    fetchRequest: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      attempt += 1;
      if (attempt === 1) {
        throw new Error("offline");
      }
      return successfulResponse(false);
    },
  });

  const first = await context.controller.activate();
  assert.equal(first.ok, false);
  assert.equal(context.controller.readState().status, "pending");
  assert.deepEqual(context.opened, []);

  const second = await context.controller.activate();
  assert.equal(second.ok, true);
  assert.deepEqual(bodies, [{ voteId: VOTE_ID }, { voteId: VOTE_ID }]);
  assert.equal(context.controller.readState().status, "confirmed");
  assert.deepEqual(context.opened, [CHANNEL_URL]);
});

test("unavailable localStorage falls back to one in-memory session vote", async () => {
  let requestCount = 0;
  const context = setup({
    getStorage: () => {
      throw new Error("blocked");
    },
    fetchRequest: async () => {
      requestCount += 1;
      return successfulResponse();
    },
  });

  await context.controller.activate();
  await context.controller.activate();
  assert.equal(requestCount, 1);
});

test("missing channel configuration does not count a vote", async () => {
  const context = setup({ channelUrl: "" });
  const result = await context.controller.activate();

  assert.deepEqual(result, { ok: false, reason: "channel-not-configured" });
  assert.equal(context.requests.length, 0);
  assert.deepEqual(context.opened, []);
});

test("clearing local storage and reloading permits a new random attempt", async () => {
  const storage = memoryStorage();
  const first = setup({ storage });
  await first.controller.activate();
  storage.removeItem("shum:rsvp:test-event:v1");

  const second = setup({
    storage,
    cryptoProvider: { randomUUID: () => OTHER_VOTE_ID },
  });
  await second.controller.activate();

  assert.equal(first.requests.length, 1);
  assert.equal(second.requests.length, 1);
  assert.deepEqual(JSON.parse(second.requests[0].options.body), { voteId: OTHER_VOTE_ID });
});
