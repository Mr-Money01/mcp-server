import type { IncomingMessage, ServerResponse } from "node:http";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer as createMcpServer } from "../server.js";

interface Session {
  transport: SSEServerTransport;
  apiKey: string;
  createdAt: number;
}

const sessions = new Map<string, Session>();

// Evict sessions older than 1 hour
setInterval(() => {
  const now = Date.now();
  const TTL = 60 * 60 * 1000;
  for (const [id, session] of sessions) {
    if (now - session.createdAt > TTL) {
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
      // Must handle errors here since we can't await in a sync function
      handleSseOpen(req, res).catch((err) => {
        console.error("[monei-mcp:sse] Error opening SSE stream:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Failed to open SSE stream" }));
        }
      });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/message") {
      handleMessage(req, res).catch((err) => {
        console.error("[monei-mcp:sse] Error handling message:", err);
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
  // 1. Auth
  const authHeader = req.headers["authorization"];
  const raw = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  const apiKey = extractBearerToken(raw);

  if (!apiKey) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      error: "Missing or invalid Authorization header. Use: Authorization: Bearer <your-monei-api-key>",
    }));
    return;
  }

  // 2. Create transport with the raw ServerResponse
  //    SSEServerTransport immediately writes SSE headers to res on construction
  const transport = new SSEServerTransport("/message", res);
  const sessionId = transport.sessionId;

  sessions.set(sessionId, { transport, apiKey, createdAt: Date.now() });
  console.error(`[monei-mcp:sse] New session ${sessionId}`);

  // 3. Connect MCP server — this triggers the transport to send the
  //    "endpoint" event with the sessionId to the client
  const server = createMcpServer(apiKey);
  await server.connect(transport);

  console.error(`[monei-mcp:sse] Session ${sessionId} connected`);

  // 4. Clean up on disconnect
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
    res.end(JSON.stringify({ error: "Missing sessionId query parameter" }));
    return;
  }

  const session = sessions.get(sessionId);
  if (!session) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      error: `Session '${sessionId}' not found or expired. Re-open /sse to start a new session.`,
    }));
    return;
  }

  await session.transport.handlePostMessage(req, res);
}

function extractBearerToken(header?: string): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}