const RSVP_COUNT_VERSION = 1;
const RSVP_COUNT_MAX = 9999;

export function formatRsvpCount(value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError("Invalid RSVP count");
  }

  return String(Math.min(value, RSVP_COUNT_MAX)).padStart(4, "0");
}

function isCachedCount(value) {
  return Boolean(
    value
      && typeof value === "object"
      && value.version === RSVP_COUNT_VERSION
      && Number.isInteger(value.count)
      && value.count >= 0,
  );
}

export function createRsvpCountController({
  endpoint,
  storageKey,
  getStorage,
  fetchRequest,
  renderCount,
  requestTimeoutMs = 8000,
}) {
  let storage;
  let storageResolved = false;
  let loadPromise = null;
  let frozen = false;

  function resolveStorage() {
    if (storageResolved) {
      return storage;
    }

    storageResolved = true;
    try {
      storage = getStorage?.() || null;
    } catch {
      storage = null;
    }
    return storage;
  }

  function readCachedCount() {
    const persistentStorage = resolveStorage();
    if (!persistentStorage) {
      return 0;
    }

    try {
      const serialized = persistentStorage.getItem(storageKey);
      if (!serialized) {
        return 0;
      }
      const cached = JSON.parse(serialized);
      if (isCachedCount(cached)) {
        return Math.min(cached.count, RSVP_COUNT_MAX);
      }
      persistentStorage.removeItem(storageKey);
    } catch {
      storage = null;
    }
    return 0;
  }

  function writeCachedCount(count) {
    const persistentStorage = resolveStorage();
    if (!persistentStorage) {
      return;
    }

    try {
      persistentStorage.setItem(storageKey, JSON.stringify({
        version: RSVP_COUNT_VERSION,
        count,
      }));
    } catch {
      storage = null;
    }
  }

  async function requestCount() {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), requestTimeoutMs);

    try {
      const response = await fetchRequest(endpoint, {
        method: "GET",
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: abortController.signal,
      });
      if (!response.ok) {
        throw new Error("RSVP count request was rejected");
      }

      const result = await response.json();
      if (
        !result
        || result.ok !== true
        || !Number.isInteger(result.count)
        || result.count < 0
      ) {
        throw new Error("RSVP count response has an invalid format");
      }

      const count = Math.min(result.count, RSVP_COUNT_MAX);
      writeCachedCount(count);
      if (!frozen) {
        renderCount(formatRsvpCount(count));
      }
      return count;
    } finally {
      clearTimeout(timeout);
    }
  }

  function load() {
    if (loadPromise) {
      return loadPromise;
    }

    renderCount(formatRsvpCount(readCachedCount()));
    loadPromise = requestCount().catch(() => readCachedCount());
    return loadPromise;
  }

  return Object.freeze({
    load,
    freeze() {
      frozen = true;
    },
  });
}
