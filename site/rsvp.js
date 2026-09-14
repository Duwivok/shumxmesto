const RSVP_VERSION = 1;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRsvpState(value) {
  return Boolean(
    value
      && typeof value === "object"
      && value.version === RSVP_VERSION
      && (value.status === "pending" || value.status === "confirmed")
      && typeof value.voteId === "string"
      && UUID_V4_PATTERN.test(value.voteId),
  );
}

function createRandomUuid(cryptoProvider) {
  if (typeof cryptoProvider?.randomUUID === "function") {
    return cryptoProvider.randomUUID();
  }

  if (typeof cryptoProvider?.getRandomValues !== "function") {
    throw new Error("Secure random generation is unavailable");
  }

  const bytes = cryptoProvider.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));

  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

function isTelegramChannelUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && (url.hostname === "t.me" || url.hostname === "telegram.me")
      && url.pathname.length > 1
      && url.search === ""
      && url.hash === "";
  } catch {
    return false;
  }
}

export function createRsvpController({
  endpoint,
  storageKey,
  channelUrl,
  enabled = true,
  getStorage,
  fetchRequest,
  cryptoProvider,
  playAnimation,
  openChannel,
  requestTimeoutMs = 8000,
}) {
  let memoryState = null;
  let persistentStorage;
  let storageWasResolved = false;
  let activationInFlight = null;

  function resolveStorage() {
    if (storageWasResolved) {
      return persistentStorage;
    }

    storageWasResolved = true;
    try {
      persistentStorage = getStorage?.() || null;
    } catch {
      persistentStorage = null;
    }

    return persistentStorage;
  }

  function disablePersistentStorage() {
    persistentStorage = null;
    storageWasResolved = true;
  }

  function readState() {
    const storage = resolveStorage();
    if (!storage) {
      return memoryState;
    }

    try {
      const serialized = storage.getItem(storageKey);
      if (!serialized) {
        return memoryState;
      }

      const state = JSON.parse(serialized);
      if (isRsvpState(state)) {
        memoryState = state;
        return state;
      }

      storage.removeItem(storageKey);
    } catch {
      disablePersistentStorage();
    }

    return memoryState;
  }

  function writeState(state) {
    memoryState = state;
    const storage = resolveStorage();
    if (!storage) {
      return;
    }

    try {
      storage.setItem(storageKey, JSON.stringify(state));
    } catch {
      disablePersistentStorage();
    }
  }

  function pendingState() {
    const current = readState();
    if (current) {
      return current;
    }

    const next = {
      version: RSVP_VERSION,
      status: "pending",
      voteId: createRandomUuid(cryptoProvider),
    };
    writeState(next);
    return next;
  }

  async function confirmRsvp() {
    const state = pendingState();
    if (state.status === "confirmed") {
      return { ok: true, counted: false, alreadyConfirmed: true };
    }

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), requestTimeoutMs);

    try {
      const response = await fetchRequest(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voteId: state.voteId }),
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error("RSVP request was rejected");
      }

      const result = await response.json();
      if (
        !result
        || result.ok !== true
        || typeof result.counted !== "boolean"
      ) {
        throw new Error("RSVP response has an invalid format");
      }

      writeState({ ...state, status: "confirmed" });
      return result;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function runActivation() {
    const animation = Promise.resolve()
      .then(() => playAnimation())
      .catch(() => undefined);

    if (!enabled) {
      await animation;
      return { ok: false, reason: "preview-disabled" };
    }

    if (!isTelegramChannelUrl(channelUrl)) {
      await animation;
      return { ok: false, reason: "channel-not-configured" };
    }

    try {
      const result = await confirmRsvp();
      await animation;
      openChannel(channelUrl);
      return result;
    } catch {
      await animation;
      return { ok: false, reason: "request-failed" };
    }
  }

  function activate() {
    if (activationInFlight) {
      return activationInFlight;
    }

    activationInFlight = runActivation().finally(() => {
      activationInFlight = null;
    });
    return activationInFlight;
  }

  return Object.freeze({
    activate,
    readState,
    isInFlight: () => activationInFlight !== null,
  });
}
