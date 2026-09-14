import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const MAX_RSVP_BODY_BYTES = 256;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".webm", "video/webm"],
  [".svg", "image/svg+xml"],
  [".woff2", "font/woff2"],
]);

function setCommonHeaders(response) {
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function sendJson(response, status, body, extraHeaders = {}) {
  const serialized = JSON.stringify(body);
  setCommonHeaders(response);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(serialized),
    ...extraHeaders,
  });
  response.end(serialized);
}

function readJsonBody(request) {
  const declaredLength = Number(request.headers["content-length"] || 0);
  if (declaredLength > MAX_RSVP_BODY_BYTES) {
    request.resume();
    return Promise.reject(Object.assign(new Error("body-too-large"), { status: 413 }));
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_RSVP_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) {
        chunks.push(chunk);
      }
    });
    request.on("end", () => {
      if (tooLarge) {
        reject(Object.assign(new Error("body-too-large"), { status: 413 }));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("invalid-json"), { status: 400 }));
      }
    });
    request.on("error", () => reject(Object.assign(new Error("request-error"), { status: 400 })));
  });
}

function validatedVoteId(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const fields = Object.keys(body);
  if (fields.length !== 1 || fields[0] !== "voteId") {
    return null;
  }
  if (typeof body.voteId !== "string" || !UUID_V4_PATTERN.test(body.voteId)) {
    return null;
  }
  return body.voteId.toLowerCase();
}

function createGlobalRateLimiter(limitPerMinute) {
  let windowStartedAt = Date.now();
  let accepted = 0;

  return () => {
    const now = Date.now();
    if (now - windowStartedAt >= 60_000) {
      windowStartedAt = now;
      accepted = 0;
    }
    if (accepted >= limitPerMinute) {
      return false;
    }
    accepted += 1;
    return true;
  };
}

async function serveStatic(request, response, staticRoot, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { ok: false }, { Allow: "GET, HEAD" });
    return;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    sendJson(response, 400, { ok: false });
    return;
  }

  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const filePath = path.resolve(staticRoot, relativePath);
  const relativeToRoot = path.relative(staticRoot, filePath);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    sendJson(response, 404, { ok: false });
    return;
  }

  let fileInfo;
  try {
    fileInfo = await fs.promises.stat(filePath);
  } catch {
    sendJson(response, 404, { ok: false });
    return;
  }
  if (!fileInfo.isFile()) {
    sendJson(response, 404, { ok: false });
    return;
  }

  setCommonHeaders(response);
  response.writeHead(200, {
    "Cache-Control": path.extname(filePath) === ".html" ? "no-cache" : "public, max-age=3600",
    "Content-Type": MIME_TYPES.get(path.extname(filePath).toLowerCase()) || "application/octet-stream",
    "Content-Length": fileInfo.size,
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }

  await pipeline(fs.createReadStream(filePath), response);
}

export function createRequestHandler({
  staticRoot,
  publicOrigin,
  rsvpOpen,
  globalLimitPerMinute,
  storage,
  notifier,
}) {
  const withinGlobalLimit = createGlobalRateLimiter(globalLimitPerMinute);

  return async function handleRequest(request, response) {
    try {
      const url = new URL(request.url, publicOrigin);
      if (url.pathname !== "/api/rsvp" || url.search !== "") {
        await serveStatic(request, response, staticRoot, url.pathname);
        return;
      }

      if (request.method !== "POST") {
        request.resume();
        sendJson(response, 405, { ok: false }, { Allow: "POST" });
        return;
      }
      if (!rsvpOpen) {
        request.resume();
        sendJson(response, 410, { ok: false });
        return;
      }
      if (request.headers.origin !== publicOrigin) {
        request.resume();
        sendJson(response, 403, { ok: false });
        return;
      }
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] || "")) {
        request.resume();
        sendJson(response, 415, { ok: false });
        return;
      }

      const body = await readJsonBody(request);
      const voteId = validatedVoteId(body);
      if (!voteId) {
        sendJson(response, 400, { ok: false });
        return;
      }
      if (!withinGlobalLimit()) {
        sendJson(response, 429, { ok: false }, { "Retry-After": "60" });
        return;
      }

      const { counted } = storage.recordVote(voteId);
      if (storage.claimNotification(voteId)) {
        try {
          await notifier.sendPlusOne();
        } catch {
          // The claim is deliberately not reset: at-most-once delivery avoids
          // duplicate organizer messages after an ambiguous Telegram failure.
        }
      }

      sendJson(response, 200, { ok: true, counted });
    } catch (error) {
      if (!response.headersSent) {
        sendJson(response, error?.status || 500, { ok: false });
      } else {
        response.destroy();
      }
    }
  };
}
