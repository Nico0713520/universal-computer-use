#!/usr/bin/env node

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HOST = "127.0.0.1";
const MAX_BODY_BYTES = 4_096;
const directory = dirname(fileURLToPath(import.meta.url));
const html = await readFile(resolve(directory, "index.html"));

const CONTROL_CENTERS = Object.freeze({
  "click-target": Object.freeze({ x: 136, y: 140 }),
  "double-target": Object.freeze({ x: 320, y: 140 }),
  "context-target": Object.freeze({ x: 504, y: 140 }),
  "text-target": Object.freeze({ x: 228, y: 250 }),
  "scroll-target": Object.freeze({ x: 548, y: 306 }),
  "drag-source": Object.freeze({ x: 136, y: 482 }),
  "drop-target": Object.freeze({ x: 388, y: 482 }),
  "static-target": Object.freeze({ x: 640, y: 482 }),
  "semantic-alpha": Object.freeze({ x: 108, y: 596 }),
  "semantic-beta": Object.freeze({ x: 228, y: 596 }),
  "semantic-gamma": Object.freeze({ x: 348, y: 596 }),
  "overlay-toggle": Object.freeze({ x: 472, y: 596 }),
  "overlay-target": Object.freeze({ x: 640, y: 600 }),
  "cursor-ab-target": Object.freeze({ x: 640, y: 656 }),
  "state-view": Object.freeze({ x: 996, y: 400 }),
});
const CURSOR_AB_RECT = Object.freeze({ left: 560, top: 640, width: 160, height: 32 });

let generation = 0;
let state = freshState();
let viewport = emptyViewport();

function freshState() {
  return {
    generation,
    reset_generation: generation,
    reset_ack_generation: generation - 1,
    semantic_sequence: [],
    text_write_count: 0,
    overlay_enabled: false,
    overlay_clicks: 0,
    clicks: 0,
    pixel_clicks: 0,
    canvas_clicks: 0,
    double_clicks: 0,
    context_menus: 0,
    moves: 0,
    text: "",
    keypresses: 0,
    last_key: null,
    scroll: { top: 0, left: 0, events: 0 },
    drop: { count: 0, last_source: null },
  };
}

function emptyViewport() {
  return {
    ready: false,
    browser_reported_origin_css: null,
    screen_css: null,
    browser_css: null,
    device_pixel_ratio: null,
  };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(response, status, value, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.byteLength),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  response.end(body);
}

function fail(response, status, code, extraHeaders = {}) {
  json(response, status, { error: code }, extraHeaders);
}

function assertPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_json_object");
  }
  return value;
}

function requireExactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new HttpError(400, "invalid_event_shape");
  }
}

function finiteNumber(value, name, { min = -Infinity, max = Infinity } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new HttpError(400, `invalid_${name}`);
  }
  return value;
}

async function readJson(request) {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "json_content_type_required");
  }
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > MAX_BODY_BYTES) {
    throw new HttpError(413, "body_too_large");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "body_too_large");
    chunks.push(chunk);
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_json");
  }
  return assertPlainObject(parsed);
}

function applyEvent(event) {
  if (typeof event.kind !== "string") throw new HttpError(400, "invalid_event_kind");

  switch (event.kind) {
    case "click":
      requireExactKeys(event, ["kind"]);
      state.clicks += 1;
      break;
    case "pixel_click":
      requireExactKeys(event, ["kind"]);
      state.pixel_clicks += 1;
      break;
    case "canvas_click": {
      requireExactKeys(event, ["kind", "x", "y"]);
      const x = finiteNumber(event.x, "canvas_x", { min: 0, max: 1280 });
      const y = finiteNumber(event.y, "canvas_y", { min: 0, max: 800 });
      if (
        x >= CURSOR_AB_RECT.left && x < CURSOR_AB_RECT.left + CURSOR_AB_RECT.width &&
        y >= CURSOR_AB_RECT.top && y < CURSOR_AB_RECT.top + CURSOR_AB_RECT.height
      ) state.canvas_clicks += 1;
      break;
    }
    case "double_click":
      requireExactKeys(event, ["kind"]);
      state.double_clicks += 1;
      break;
    case "context_menu":
      requireExactKeys(event, ["kind"]);
      state.context_menus += 1;
      break;
    case "move":
      requireExactKeys(event, ["kind"]);
      state.moves += 1;
      break;
    case "text":
      requireExactKeys(event, ["kind", "value"]);
      if (typeof event.value !== "string" || [...event.value].length > 20_000) {
        throw new HttpError(400, "invalid_text");
      }
      state.text = event.value;
      state.text_write_count += 1;
      break;
    case "semantic":
      requireExactKeys(event, ["kind", "value"]);
      if (!["alpha", "beta", "gamma"].includes(event.value)) {
        throw new HttpError(400, "invalid_semantic_value");
      }
      state.semantic_sequence.push(event.value);
      break;
    case "overlay_toggle":
      requireExactKeys(event, ["kind"]);
      state.overlay_enabled = !state.overlay_enabled;
      break;
    case "overlay_click":
      requireExactKeys(event, ["kind"]);
      state.overlay_clicks += 1;
      break;
    case "reset_ack":
      requireExactKeys(event, ["kind", "generation"]);
      if (!Number.isSafeInteger(event.generation) || event.generation !== state.reset_generation) {
        throw new HttpError(409, "reset_generation_mismatch");
      }
      state.reset_ack_generation = event.generation;
      break;
    case "keypress":
      requireExactKeys(event, ["kind", "key"]);
      if (typeof event.key !== "string" || event.key.length < 1 || event.key.length > 24) {
        throw new HttpError(400, "invalid_key");
      }
      state.keypresses += 1;
      state.last_key = event.key;
      break;
    case "scroll":
      requireExactKeys(event, ["kind", "top", "left"]);
      state.scroll = {
        top: finiteNumber(event.top, "scroll_top", { min: 0, max: 100_000 }),
        left: finiteNumber(event.left, "scroll_left", { min: 0, max: 100_000 }),
        events: state.scroll.events + 1,
      };
      break;
    case "drop":
      requireExactKeys(event, ["kind", "source"]);
      if (event.source !== "drag-source") throw new HttpError(400, "invalid_drop_source");
      state.drop = { count: state.drop.count + 1, last_source: event.source };
      break;
    case "viewport": {
      requireExactKeys(event, [
        "kind", "screen_x", "screen_y", "screen_width", "screen_height", "outer_width",
        "outer_height", "inner_width", "inner_height", "device_pixel_ratio",
      ]);
      const screenX = finiteNumber(event.screen_x, "screen_x", { min: -100_000, max: 100_000 });
      const screenY = finiteNumber(event.screen_y, "screen_y", { min: -100_000, max: 100_000 });
      const screenWidth = finiteNumber(event.screen_width, "screen_width", { min: 1, max: 100_000 });
      const screenHeight = finiteNumber(event.screen_height, "screen_height", { min: 1, max: 100_000 });
      viewport = {
        ready: true,
        // Diagnostic only. Real lanes inject a separately measured screenshot-pixel origin.
        browser_reported_origin_css: { x: screenX, y: screenY },
        screen_css: { width: screenWidth, height: screenHeight },
        browser_css: {
          outer_width: finiteNumber(event.outer_width, "outer_width", { min: 1, max: 100_000 }),
          outer_height: finiteNumber(event.outer_height, "outer_height", { min: 1, max: 100_000 }),
          inner_width: finiteNumber(event.inner_width, "inner_width", { min: 1, max: 100_000 }),
          inner_height: finiteNumber(event.inner_height, "inner_height", { min: 1, max: 100_000 }),
        },
        device_pixel_ratio: finiteNumber(event.device_pixel_ratio, "device_pixel_ratio", { min: 0.25, max: 8 }),
      };
      break;
    }
    default:
      throw new HttpError(400, "unsupported_event");
  }

  return state;
}

export function startDesktopHarness() {
  const server = createServer(async (request, response) => {
    try {
      if (request.socket.remoteAddress !== HOST) {
        fail(response, 403, "loopback_only");
        return;
      }
      const host = request.headers.host ?? "";
      if (host !== `${HOST}:${String(request.socket.localPort)}`) {
        fail(response, 400, "invalid_host");
        return;
      }
      const requestUrl = new URL(request.url ?? "/", `http://${host}`);
      if (requestUrl.search !== "") {
        fail(response, 400, "query_not_supported");
        return;
      }

      const allowed = new Map([
        ["/", "GET"],
        ["/layout", "GET"],
        ["/generation", "GET"],
        ["/state", "GET"],
        ["/reset", "POST"],
        ["/event", "POST"],
      ]);
      const expectedMethod = allowed.get(requestUrl.pathname);
      if (expectedMethod === undefined) {
        fail(response, 404, "not_found");
        return;
      }
      if (request.method !== expectedMethod) {
        fail(response, 405, "method_not_allowed", { allow: expectedMethod });
        return;
      }

      if (requestUrl.pathname === "/") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-length": String(html.byteLength),
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        });
        response.end(html);
        return;
      }
      if (requestUrl.pathname === "/layout") {
        json(response, 200, {
          canvas: { width: 1280, height: 800 },
          zoom: 1,
          coordinate_space: "css_pixels",
          controls: CONTROL_CENTERS,
          viewport,
        });
        return;
      }
      if (requestUrl.pathname === "/state") {
        json(response, 200, state);
        return;
      }
      if (requestUrl.pathname === "/generation") {
        json(response, 200, { reset_generation: state.reset_generation });
        return;
      }
      if (requestUrl.pathname === "/reset") {
        const body = await readJson(request);
        requireExactKeys(body, []);
        generation += 1;
        state = freshState();
        json(response, 200, state);
        return;
      }
      const event = await readJson(request);
      json(response, 200, applyEvent(event));
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof HttpError) fail(response, error.status, error.message);
      else fail(response, 500, "internal_error");
    }
  });

  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen({ host: HOST, port: 0, exclusive: true }, () => {
      server.off("error", reject);
      const address = server.address();
      if (address === null || typeof address === "string" || address.address !== HOST) {
        server.close();
        reject(new Error("desktop harness did not bind to IPv4 loopback"));
        return;
      }
      resolvePromise({
        url: `http://${HOST}:${address.port}`,
        close: () => new Promise((resolveClose, rejectClose) => {
          server.close((error) => error === undefined ? resolveClose() : rejectClose(error));
        }),
      });
    });
  });
}

function isDirectEntryPoint() {
  const entry = process.argv[1];
  return entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url;
}

if (isDirectEntryPoint()) {
  const running = await startDesktopHarness();
  process.stdout.write(`${JSON.stringify({ url: running.url })}\n`);
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    void running.close().then(() => {
      process.exitCode = 0;
    });
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}
