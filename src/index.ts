import * as http from "node:http";
import { Hono } from "hono";
import { createServer as createMcpServer } from "./server.js";
import { runStdio } from "./transport/stdio.js";
import { createHttpApp } from "./transport/http.js";
import { createSseListener } from "./transport/sse.js";

const transport = (process.env.MONEI_TRANSPORT ?? "stdio").toLowerCase();
const port = parseInt(process.env.PORT ?? "3000");

/**
 * Minimal Node-compatible handler for Hono.
 * Converts a Node IncomingMessage into a Web Request, calls app.fetch,
 * then pipes the Web Response back to ServerResponse.
 * This replaces getRequestListener() which is not reliably exported.
 */
async function honoFetch(
  app: Hono,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const url = `http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`;

  // Read body for non-GET requests
  const body =
    req.method !== "GET" && req.method !== "HEAD"
      ? await new Promise<Buffer>((resolve, reject) => {
          const chunks: Buffer[] = [];
          req.on("data", (c: Buffer) => chunks.push(c));
          req.on("end", () => resolve(Buffer.concat(chunks)));
          req.on("error", reject);
        })
      : undefined;

  const webReq = new Request(url, {
    method: req.method ?? "GET",
    headers: req.headers as Record<string, string>,
    body: body && body.length > 0 ? body : undefined,
  });

  const webRes = await app.fetch(webReq);

  res.writeHead(
    webRes.status,
    Object.fromEntries(webRes.headers.entries())
  );

  if (webRes.body) {
    const reader = webRes.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  }

  res.end();
}

async function main(): Promise<void> {
  switch (transport) {
    case "stdio": {
      const server = createMcpServer(process.env.MONEI_API_KEY);
      await runStdio(server);
      break;
    }

    case "http": {
      const { app, mcpListener } = createHttpApp();

      http
        .createServer((req, res) => {
          if (req.url?.startsWith("/mcp")) {
            mcpListener(req, res).catch((err) => {
              console.error("[monei-mcp] Error in mcpListener:", err);
              if (!res.headersSent) { res.writeHead(500); res.end(); }
            });
          } else {
            honoFetch(app, req, res).catch((err) => {
              console.error("[monei-mcp] Error in honoFetch:", err);
              if (!res.headersSent) { res.writeHead(500); res.end(); }
            });
          }
        })
        .listen(port, () => {
          console.error(`[monei-mcp] HTTP transport on port ${port}`);
          console.error(`[monei-mcp] POST http://localhost:${port}/mcp`);
          console.error(`[monei-mcp] GET  http://localhost:${port}/health`);
        });
      break;
    }

    case "sse": {
      const honoApp = new Hono();
      honoApp.get("/health", (c) =>
        c.json({
          status: "ok",
          server: "monei-mcp",
          version: "1.0.0",
          timestamp: new Date().toISOString(),
        })
      );

      const sseListener = createSseListener();

      http
        .createServer((req, res) => {
          // sseListener handles /sse and /message — returns true if handled
          if (!sseListener(req, res)) {
            // Everything else (e.g. /health) goes through Hono
            honoFetch(honoApp, req, res).catch((err) => {
              console.error("[monei-mcp] Error in honoFetch:", err);
              if (!res.headersSent) { res.writeHead(500); res.end(); }
            });
          }
        })
        .listen(port, () => {
          console.error(`[monei-mcp] SSE transport on port ${port}`);
          console.error(`[monei-mcp] GET  http://localhost:${port}/sse`);
          console.error(`[monei-mcp] POST http://localhost:${port}/message`);
          console.error(`[monei-mcp] GET  http://localhost:${port}/health`);
        });
      break;
    }

    default:
      console.error(`[monei-mcp] Unknown transport: '${transport}'. Use stdio, http, or sse.`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("[monei-mcp] Fatal error:", err);
  process.exit(1);
});