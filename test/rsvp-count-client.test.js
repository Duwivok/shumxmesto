import test from "node:test";
import assert from "node:assert/strict";
import {
  createRsvpCountController,
  formatRsvpCount,
} from "../site/rsvp-count.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("RSVP counts are padded and capped at four digits", () => {
  assert.equal(formatRsvpCount(0), "0000");
  assert.equal(formatRsvpCount(394), "0394");
  assert.equal(formatRsvpCount(9999), "9999");
  assert.equal(formatRsvpCount(10_001), "9999");
});

test("the cached count renders immediately and one fresh count is requested", async () => {
  const storageKey = "shum:rsvp-count:test:v1";
  const storage = memoryStorage({
    [storageKey]: JSON.stringify({ version: 1, count: 394 }),
  });
  const renders = [];
  let requests = 0;
  const controller = createRsvpCountController({
    endpoint: "/api/rsvp-count",
    storageKey,
    getStorage: () => storage,
    fetchRequest: async () => {
      requests += 1;
      return { ok: true, json: async () => ({ ok: true, count: 402 }) };
    },
    renderCount: (value) => renders.push(value),
  });

  const first = controller.load();
  const second = controller.load();
  await Promise.all([first, second]);

  assert.equal(requests, 1);
  assert.deepEqual(renders, ["0394", "0402"]);
  assert.deepEqual(JSON.parse(storage.getItem(storageKey)), { version: 1, count: 402 });
});

test("a failed request leaves the last cached count visible", async () => {
  const storageKey = "shum:rsvp-count:test:v1";
  const storage = memoryStorage({
    [storageKey]: JSON.stringify({ version: 1, count: 73 }),
  });
  const renders = [];
  const controller = createRsvpCountController({
    endpoint: "/api/rsvp-count",
    storageKey,
    getStorage: () => storage,
    fetchRequest: async () => {
      throw new Error("offline");
    },
    renderCount: (value) => renders.push(value),
  });

  await controller.load();
  assert.deepEqual(renders, ["0073"]);
});

test("freezing prevents a late response from changing the open screen", async () => {
  let releaseRequest;
  const requestGate = new Promise((resolve) => {
    releaseRequest = resolve;
  });
  const renders = [];
  const controller = createRsvpCountController({
    endpoint: "/api/rsvp-count",
    storageKey: "shum:rsvp-count:test:v1",
    getStorage: () => memoryStorage(),
    fetchRequest: async () => {
      await requestGate;
      return { ok: true, json: async () => ({ ok: true, count: 1 }) };
    },
    renderCount: (value) => renders.push(value),
  });

  const loading = controller.load();
  controller.freeze();
  releaseRequest();
  await loading;

  assert.deepEqual(renders, ["0000"]);
});
