import { Hono } from "hono";
import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "../server.js";

/**
 * HTTP transport using Hono + StreamableHTTP.
 *
 * StreamableHTTPServerTransport expects Node.js IncomingMessage / ServerResponse,
 * not the Web Request / Response API.
 *
 * We use Hono's middleware to intercept at the Node layer before Hono parses
 * the request, giving the transport the raw Node objects it needs.
 *
 * Auth: Authorization: Bearer <monei-api-key> on every request.
 */

interface ActiveSession {
  transport: StreamableHTTPServerTransport;
  apiKey: string;
  createdAt: number;
}

const sessions = new Map<string, ActiveSession>();

// Evict sessions older than 30 minutes
setInterval(() => {
  const now = Date.now();
  const TTL = 30 * 60 * 1000;
  for (const [id, session] of sessions) {
    if (now - session.createdAt > TTL) {
      sessions.delete(id);
      console.error(`[monei-mcp:http] Evicted session ${id}`);
    }
  }
}, 10 * 60 * 1000);

/**
 * Returns a raw Node.js http.RequestListener that Hono's node server
 * can use for the /mcp route.
 *
 * Usage in main.ts:
 *   import { createServer as createNodeServer } from "@hono/node-server";
 *   const { mcpListener, honoApp } = createHttpApp();
 *   createNodeServer({
 *     fetch: honoApp.fetch,
 *     createServer: (handler) => {
 *       const srv = http.createServer((req, res) => {
 *         if (req.url?.startsWith("/mcp")) return mcpListener(req, res);
 *         handler(req, res);
 *       });
 *       return srv;
 *     },
 *     port,
 *   });
 */
export function createHttpApp(): {
  app: Hono;
  mcpListener: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
} {
  const app = new Hono();

  // ─── Health ────────────────────────────────────────────────────────────────
  app.get("/health", (c) =>
    c.json({
      status: "ok",
      server: "monei-mcp",
      version: "1.0.0",
      activeSessions: sessions.size,
      timestamp: new Date().toISOString(),
    })
  );

  // ─── Raw Node listener for /mcp ────────────────────────────────────────────
  // This handles POST, GET, DELETE at the Node layer so StreamableHTTPServerTransport
  // gets the IncomingMessage / ServerResponse it was designed for.
  const mcpListener = async (
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> => {
    // 1. Auth — read Authorization header directly from IncomingMessage
    const authHeader = req.headers["authorization"];
    const apiKey = extractBearerToken(
      Array.isArray(authHeader) ? authHeader[0] : authHeader
    );

    if (!apiKey) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error:
            "Missing or invalid Authorization header. Use: Authorization: Bearer <your-monei-api-key>",
        })
      );
      return;
    }

    // 2. DELETE — tear down session
    if (req.method === "DELETE") {
      const sessionId = req.headers["mcp-session-id"];
      const id = Array.isArray(sessionId) ? sessionId[0] : sessionId;
      if (id) {
        sessions.delete(id);
        console.error(`[monei-mcp:http] Session ${id} deleted`);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // 3. Resolve session ID from header
    const sessionHeader = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionHeader)
      ? sessionHeader[0]
      : sessionHeader;

    try {
      if (sessionId && sessions.has(sessionId)) {
        // Existing session — hand straight to transport
        const { transport } = sessions.get(sessionId)!;
        await transport.handleRequest(req, res);
        return;
      }

      if (!sessionId && req.method === "POST") {
        // New session — must be an initialize request.
        // We read the body to check, then re-push it so the transport
        // can read it again via the stream.
        const rawBody = await readBody(req);
        let body: unknown;
        try {
          body = JSON.parse(rawBody);
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }

        if (!isInitializeRequest(body)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error:
                "First request must be a valid MCP initialize request. Include mcp-session-id for subsequent calls.",
            })
          );
          return;
        }

        // Re-inject the body back into the stream so the transport can read it
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (id) => {
            sessions.set(id, { transport, apiKey, createdAt: Date.now() });
            console.error(`[monei-mcp:http] New session ${id}`);
          },
        });

        const server = createServer(apiKey);
        await server.connect(transport);

        // Push the already-read body back so handleRequest can consume it
        req.push(Buffer.from(rawBody));
        req.push(null);

        await transport.handleRequest(req, res);
        return;
      }

      // No session + not POST initialize
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error:
            "No active session. Send a POST initialize request first (without mcp-session-id header).",
        })
      );
    } catch (error) {
      console.error(
        "[monei-mcp:http] Error:",
        error instanceof Error ? error.message : error
      );
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    }
  };

  return { app, mcpListener };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractBearerToken(header?: string): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

/** Reads the full body from a Node IncomingMessage into a string. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}