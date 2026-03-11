import * as http from "node:http";
import { Hono } from "hono";
import { createServer as createMcpServer } from "./server.js";
import { runStdio } from "./transport/stdio.js";
import { createHttpApp } from "./transport/http.js";
import { createSseListener } from "./transport/sse.js";
import { createOAuthListener } from "./transport/oauth.js";

const transport = (process.env.MONEI_TRANSPORT ?? "stdio").toLowerCase();
const port = parseInt(process.env.PORT ?? "3000");

async function honoFetch(
  app: Hono,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const url = `http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`;
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
  res.writeHead(webRes.status, Object.fromEntries(webRes.headers.entries()));

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
      const oauthListener = createOAuthListener();

      http
        .createServer((req, res) => {
          if (oauthListener(req, res)) return;
          if (req.url?.startsWith("/mcp")) {
            mcpListener(req, res).catch((err) => {
              console.error("[monei-mcp] Error:", err);
              if (!res.headersSent) { res.writeHead(500); res.end(); }
            });
            return;
          }
          honoFetch(app, req, res).catch((err) => {
            console.error("[monei-mcp] Error:", err);
            if (!res.headersSent) { res.writeHead(500); res.end(); }
          });
        })
        .listen(port, () => {
          console.error(`[monei-mcp] HTTP transport on port ${port}`);
        });
      break;
    }

    case "sse": {
      const honoApp = new Hono();

      honoApp.get("/health", (c) =>
        c.json({
          status: "ok",
          server: "monei-mcp",
          version: "1.1.0",
          timestamp: new Date().toISOString(),
        })
      );

      // Root redirect → /sse (Claude.ai hits the base URL after OAuth)
      honoApp.get("/", (c) => c.redirect("/sse", 302));

      const oauthListener = createOAuthListener();
      const sseListener = createSseListener();

      http
        .createServer((req, res) => {
          // OAuth endpoints first
          if (oauthListener(req, res)) return;
          // SSE endpoints
          if (sseListener(req, res)) return;
          // Health, root redirect, fallback
          honoFetch(honoApp, req, res).catch((err) => {
            console.error("[monei-mcp] Error:", err);
            if (!res.headersSent) { res.writeHead(500); res.end(); }
          });
        })
        .listen(port, () => {
          console.error(`[monei-mcp] SSE transport on port ${port}`);
          console.error(`[monei-mcp] GET   http://localhost:${port}/sse`);
          console.error(`[monei-mcp] POST  http://localhost:${port}/message`);
          console.error(`[monei-mcp] GET   http://localhost:${port}/health`);
          console.error(`[monei-mcp] GET   http://localhost:${port}/.well-known/oauth-authorization-server`);
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