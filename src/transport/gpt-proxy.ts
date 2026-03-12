import type { IncomingMessage, ServerResponse } from "node:http";
import { getApiKeyFromToken } from "./oauth.js";

// ─── Config ──────────────────────────────────────────────────────────────────

const MONEI_ENV = (process.env.MONEI_ENV ?? "live").toLowerCase();
const BACKEND_BASE =
  MONEI_ENV === "live"
    ? "https://api.monei.cc"
    : "https://api.dev.monei.cc";

// ─── Proxy listener ──────────────────────────────────────────────────────────

/**
 * createGptProxyListener
 *
 * Returns a Node http listener that handles all requests to /gpt/*.
 * Flow:
 *   1. Extract Bearer token from Authorization header
 *   2. Look up real Monei API key from OAuth token store
 *      → if not found, treat the Bearer token itself as a raw API key
 *      → if neither exists, return 401
 *   3. Strip /gpt prefix from URL path
 *   4. Forward full request to api.monei.cc (or api.dev.monei.cc) with X-API-KEY header
 *   5. Pipe response status, headers, and body back to the caller
 *
 * Returns true if the request was handled (URL starts with /gpt/), false otherwise.
 */
export function createGptProxyListener(): (
  req: IncomingMessage,
  res: ServerResponse
) => boolean {
  return (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (!url.pathname.startsWith("/gpt/") && url.pathname !== "/gpt") {
      return false;
    }

    handleProxy(req, res, url).catch((err) => {
      console.error("[monei-mcp:gpt-proxy] Error:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "proxy_error", message: String(err) }));
      }
    });

    return true;
  };
}

async function handleProxy(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<void> {
  // ── 1. Extract and resolve API key ─────────────────────────────────────────
  const authHeader = req.headers["authorization"];
  const raw = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  const bearerToken = raw?.replace(/^Bearer\s+/i, "").trim();

  if (!bearerToken) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "unauthorized",
        error_description:
          "Authorization required. Provide your Monei API key as a Bearer token.",
      })
    );
    return;
  }

  // Try OAuth token store first → falls back to treating token as raw API key
  const apiKey = getApiKeyFromToken(bearerToken) ?? bearerToken;

  // ── 2. Build upstream URL ──────────────────────────────────────────────────
  // Strip /gpt prefix: /gpt/api/v1/user/me → /api/v1/user/me
  const upstreamPath = url.pathname.replace(/^\/gpt/, "") || "/";
  const upstreamUrl = `${BACKEND_BASE}${upstreamPath}${url.search}`;

  // ── 3. Read request body (pass through for POST/PATCH/PUT) ─────────────────
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const body = hasBody
    ? await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
      })
    : undefined;

  // ── 4. Build forwarded headers ─────────────────────────────────────────────
  // Forward all original headers except Authorization (replaced with X-API-KEY)
  // and headers that break fetch (host, connection, transfer-encoding)
  const forwardHeaders: Record<string, string> = {};
  const skipHeaders = new Set([
    "authorization",
    "host",
    "connection",
    "transfer-encoding",
    "keep-alive",
  ]);

  for (const [key, value] of Object.entries(req.headers)) {
    if (!skipHeaders.has(key.toLowerCase()) && value) {
      forwardHeaders[key] = Array.isArray(value) ? value.join(", ") : value;
    }
  }

  forwardHeaders["X-API-KEY"] = apiKey;
  forwardHeaders["Accept"] = forwardHeaders["Accept"] ?? "application/json";

  // ── 5. Forward to Monei backend ────────────────────────────────────────────
  console.error(
    `[monei-mcp:gpt-proxy] ${req.method} ${upstreamPath} → ${BACKEND_BASE}`
  );

  const upstream = await fetch(upstreamUrl, {
    method: req.method ?? "GET",
    headers: forwardHeaders,
    body: body && body.length > 0 ? body : undefined,
  });

  // ── 6. Pipe response back ──────────────────────────────────────────────────
  const responseHeaders: Record<string, string> = {
    "Content-Type":
      upstream.headers.get("content-type") ?? "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };

  // Forward relevant response headers from backend
  const forwardResponseHeaders = [
    "cache-control",
    "x-request-id",
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-reset",
  ];
  for (const header of forwardResponseHeaders) {
    const value = upstream.headers.get(header);
    if (value) responseHeaders[header] = value;
  }

  res.writeHead(upstream.status, responseHeaders);

  if (upstream.body) {
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  }

  res.end();
}

// ─── CORS preflight handler ───────────────────────────────────────────────────

/**
 * Handle OPTIONS preflight requests for /gpt/* routes.
 * ChatGPT sends these before every actual request.
 */
export function handleGptCors(
  req: IncomingMessage,
  res: ServerResponse
): boolean {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (
    req.method === "OPTIONS" &&
    (url.pathname.startsWith("/gpt/") || url.pathname === "/gpt")
  ) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return true;
  }

  return false;
}