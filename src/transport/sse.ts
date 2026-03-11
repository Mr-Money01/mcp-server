import type { IncomingMessage, ServerResponse } from "node:http";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer as createMcpServer } from "../server.js";
import { getApiKeyFromToken } from "./oauth.js";

interface Session {
  transport: SSEServerTransport;
  createdAt: number;
}

const sessions = new Map<string, Session>();

// Evict sessions older than 1 hour
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > 60 * 60 * 1000) {
      sessions.delete(id);
      console.error(`[monei-mcp:sse] Evicted expired session ${id}`);
    }
  }
}, 5 * 60 * 1000);

export function createSseListener(): (
  req: IncomingMessage,
  res: ServerResponse
) => boolean {
  return (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/sse") {
      handleSseOpen(req, res).catch((err) => {
        console.error("[monei-mcp:sse] Error:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Failed to open SSE stream" }));
        }
      });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/message") {
      handleMessage(req, res).catch((err) => {
        console.error("[monei-mcp:sse] Error:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Failed to process message" }));
        }
      });
      return true;
    }

    return false;
  };
}

async function handleSseOpen(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  // Extract API key — supports both:
  // 1. OAuth access token (Claude.ai web) → look up real API key
  // 2. Raw Monei API key (Claude Desktop, Cursor, direct use)
  const authHeader = req.headers["authorization"];
  const raw = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  const bearerToken = raw?.replace(/^Bearer\s+/i, "").trim();

  if (!bearerToken) {
    // Return 401 with WWW-Authenticate so Claude.ai triggers OAuth flow
    const baseUrl = process.env.MCP_BASE_URL ?? "https://mcp.monei.cc";
    res.writeHead(401, {
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer realm="${baseUrl}", resource_metadata_url="${baseUrl}/.well-known/oauth-authorization-server"`,
    });
    res.end(JSON.stringify({
      error: "unauthorized",
      error_description: "Authorization required. Connect via OAuth or pass your Monei API key as a Bearer token.",
    }));
    return;
  }

  // Try OAuth token lookup first, fall back to treating as raw API key
  const apiKey = getApiKeyFromToken(bearerToken) ?? bearerToken;

  const transport = new SSEServerTransport("/message", res);
  const sessionId = transport.sessionId;

  sessions.set(sessionId, { transport, createdAt: Date.now() });
  console.error(`[monei-mcp:sse] New session ${sessionId}`);

  const server = createMcpServer(apiKey);
  await server.connect(transport);

  console.error(`[monei-mcp:sse] Session ${sessionId} connected`);

  res.on("close", () => {
    sessions.delete(sessionId);
    console.error(`[monei-mcp:sse] Session ${sessionId} closed`);
  });
}

async function handleMessage(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const sessionId = url.searchParams.get("sessionId");

  if (!sessionId) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing sessionId" }));
    return;
  }

  const session = sessions.get(sessionId);
  if (!session) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Session '${sessionId}' not found or expired` }));
    return;
  }

  await session.transport.handlePostMessage(req, res);
}