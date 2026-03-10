/**
 * Test script for the SSE transport.
 *
 * Run with:
 *   MONEI_API_KEY=your_key npx tsx src/scripts/test-sse.ts
 *
 * Requires the server running in SSE mode:
 *   MONEI_TRANSPORT=sse MONEI_API_KEY=your_key node dist/index.js
 */

import * as http from "node:http";

const BASE_URL = process.env.MCP_SERVER_URL ?? "http://localhost:3000";
const API_KEY = process.env.MONEI_API_KEY ?? "";

if (!API_KEY) {
  console.error("Error: MONEI_API_KEY is not set.");
  process.exit(1);
}

const parsedUrl = new URL(BASE_URL);
const HOST = parsedUrl.hostname;
const PORT = parseInt(parsedUrl.port || "3000");

let sessionId: string | null = null;

// ─── SSE stream ───────────────────────────────────────────────────────────────

/**
 * Opens GET /sse, waits for the endpoint event (which carries the sessionId),
 * then resolves. Returns getNextEvent() for subsequent responses and close().
 *
 * SSEServerTransport sends the endpoint event as the very first thing after
 * server.connect() completes:
 *   event: endpoint
 *   data: /message?sessionId=<uuid>
 */
function openSseStream(): Promise<{
  getNextEvent: () => Promise<{ type: string; data: string }>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: HOST,
      port: PORT,
      path: "/sse",
      method: "GET",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });

    const timeout = setTimeout(() => {
      req.destroy();
      reject(new Error("Timeout: no response from GET /sse after 5s"));
    }, 5000);

    req.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    req.on("response", (res) => {
      clearTimeout(timeout);

      if (res.statusCode !== 200 && res.statusCode !== 202) {
        let body = "";
        res.on("data", (d: Buffer) => (body += d.toString()));
        res.on("end", () =>
          reject(new Error(`GET /sse failed ${res.statusCode}: ${body}`))
        );
        return;
      }

      // Queue for events that arrive after the stream is opened
      const eventQueue: { type: string; data: string }[] = [];
      const waiters: ((e: { type: string; data: string }) => void)[] = [];
      let buffer = "";
      let streamResolved = false;

      const emit = (event: { type: string; data: string }) => {
        // Capture sessionId from the endpoint event
        if (event.type === "endpoint") {
          const match = event.data.match(/sessionId=([^&\s]+)/);
          if (match) sessionId = match[1];
        }

        if (!streamResolved) {
          // We resolve as soon as we get the endpoint event
          if (event.type === "endpoint") {
            streamResolved = true;
            resolve({
              getNextEvent: () =>
                new Promise((r) => {
                  if (eventQueue.length > 0) r(eventQueue.shift()!);
                  else waiters.push(r);
                }),
              close: () => req.destroy(),
            });
          } else {
            // Unexpected first event — reject
            reject(new Error(`Expected endpoint event, got: ${JSON.stringify(event)}`));
          }
          return;
        }

        // After resolved — queue normally for getNextEvent()
        if (waiters.length > 0) {
          waiters.shift()!(event);
        } else {
          eventQueue.push(event);
        }
      };

      res.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let eventType = "message";
        let dataLine = "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            dataLine = line.slice(6).trim();
          } else if (line === "" && dataLine) {
            emit({ type: eventType, data: dataLine });
            eventType = "message";
            dataLine = "";
          }
        }
      });

      res.on("error", (err) => {
        if (!streamResolved) reject(err);
        else console.error("[test-sse] Stream error:", err.message);
      });

      res.on("end", () => {
        if (!streamResolved) {
          reject(new Error("SSE stream ended before endpoint event was received"));
        }
      });
    });

    req.end();
  });
}

// ─── POST /message ────────────────────────────────────────────────────────────

function postMessage(message: object): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!sessionId) {
      reject(new Error("No sessionId — open /sse first"));
      return;
    }

    const body = JSON.stringify(message);

    const req = http.request({
      host: HOST,
      port: PORT,
      path: `/message?sessionId=${sessionId}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        Authorization: `Bearer ${API_KEY}`,
      },
    });

    const timeout = setTimeout(() => {
      req.destroy();
      reject(new Error("Timeout: POST /message took longer than 5s"));
    }, 5000);

    req.on("error", (err) => { clearTimeout(timeout); reject(err); });

    req.on("response", (res) => {
      clearTimeout(timeout);
      let raw = "";
      res.on("data", (d: Buffer) => (raw += d.toString()));
      res.on("end", () => {
        if (res.statusCode !== 200 && res.statusCode !== 202) {
          reject(new Error(`POST /message failed ${res.statusCode}: ${raw}`));
        } else {
          resolve();
        }
      });
    });

    req.write(body);
    req.end();
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout (${ms}ms): ${label}`)), ms)
    ),
  ]);
}

// ─── Test runner ──────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔌 Connecting to ${BASE_URL} (SSE)\n`);

  // ── 1. Health check ───────────────────────────────────────────────────────
  console.log("1. Health check...");
  const health = await fetch(`${BASE_URL}/health`).then(
    (r) => r.json()
  ) as { status: string; timestamp: string };
  console.log("   ✅", health.status, "-", health.timestamp, "\n");

  // ── 2. Open SSE stream ────────────────────────────────────────────────────
  console.log("2. Opening SSE stream...");
  const { getNextEvent, close } = await withTimeout(
    openSseStream(),
    8000,
    "opening SSE stream and waiting for endpoint event"
  );
  console.log("   ✅ Session ID:", sessionId, "\n");

  // ── 3. Initialize ─────────────────────────────────────────────────────────
  console.log("3. Sending initialize...");
  await postMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-sse-script", version: "1.0.0" },
    },
  });

  const initEvent = await withTimeout(getNextEvent(), 5000, "initialize response");
  const initResult = JSON.parse(initEvent.data);
  if (initResult.error) throw new Error(`Initialize failed: ${JSON.stringify(initResult.error)}`);
  console.log("   ✅ Server:", initResult.result?.serverInfo?.name ?? "(unnamed)", "\n");

  // ── 4. List tools ─────────────────────────────────────────────────────────
  console.log("4. Listing tools...");
  await postMessage({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });

  const toolsEvent = await withTimeout(getNextEvent(), 5000, "tools/list response");
  const toolsResult = JSON.parse(toolsEvent.data);
  if (toolsResult.error) throw new Error(`tools/list failed: ${JSON.stringify(toolsResult.error)}`);

  const tools: string[] = toolsResult.result?.tools?.map((t: any) => t.name) ?? [];
  console.log(`   ✅ ${tools.length} tools registered:`);
  tools.forEach((name) => console.log(`      - ${name}`));
  console.log();

  // ── 5. Call monei_get_account ─────────────────────────────────────────────
  console.log("5. Calling monei_get_account...");
  await postMessage({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "monei_get_account", arguments: {} },
  });

  const accountEvent = await withTimeout(getNextEvent(), 10000, "monei_get_account response");
  const accountResult = JSON.parse(accountEvent.data);
  const content = accountResult.result?.content?.[0]?.text;
  if (accountResult.result?.isError) {
    console.log("   ⚠️  Tool returned error:", content);
  } else {
    const account = JSON.parse(content ?? "{}");
    console.log("   ✅ Account:", account.email ?? account.firstName ?? "(no email)");
  }
  console.log();

  // ── Done ─────────────────────────────────────────────────────────────────
  close();
  console.log("✅ All checks passed. SSE transport is working correctly.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Test failed:", err.message);
  process.exit(1);
});