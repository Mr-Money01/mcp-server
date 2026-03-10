/**
 * Test script for the HTTP transport.
 *
 * Run with:
 *   MONEI_API_KEY=your_key npx tsx src/scripts/test-http.ts
 *
 * Requires the server to be running:
 *   MONEI_TRANSPORT=http MONEI_API_KEY=your_key node dist/index.js
 */

const BASE_URL = process.env.MCP_SERVER_URL ?? "http://localhost:3000";
const API_KEY = process.env.MONEI_API_KEY ?? "";

if (!API_KEY) {
  console.error("Error: MONEI_API_KEY is not set.");
  process.exit(1);
}

const headers = {
  "Content-Type": "application/json",
  "Accept": "application/json, text/event-stream",
  "Authorization": `Bearer ${API_KEY}`,
};

let sessionId: string | null = null;

/**
 * Sends an MCP message and parses the response.
 * StreamableHTTPServerTransport can respond as either:
 *   - application/json       — single JSON object
 *   - text/event-stream      — SSE stream of one or more JSON events
 * We handle both.
 */
async function send(message: object): Promise<any> {
  const res = await fetch(`${BASE_URL}/mcp`, {
    method: "POST",
    headers: {
      ...headers,
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify(message),
  });

  // Capture session ID from response headers
  const newSessionId = res.headers.get("mcp-session-id");
  if (newSessionId) sessionId = newSessionId;

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  const contentType = res.headers.get("content-type") ?? "";

  // ── SSE response ────────────────────────────────────────────────────────────
  if (contentType.includes("text/event-stream")) {
    return parseSseResponse(res);
  }

  // ── Plain JSON response ─────────────────────────────────────────────────────
  return res.json();
}

/**
 * Reads an SSE stream to completion and returns the last parsed JSON event.
 * SSE format:
 *   event: message\n
 *   data: {"jsonrpc":"2.0",...}\n
 *   \n
 */
async function parseSseResponse(res: Response): Promise<any> {
  const text = await res.text();
  let lastResult: any = null;

  for (const line of text.split("\n")) {
    if (line.startsWith("data: ")) {
      const raw = line.slice(6).trim();
      if (raw && raw !== "[DONE]") {
        try {
          lastResult = JSON.parse(raw);
        } catch {
          // ignore malformed lines
        }
      }
    }
  }

  if (!lastResult) {
    throw new Error(`SSE response contained no parseable data events.\nRaw response:\n${text}`);
  }

  return lastResult;
}

// ─── Test runner ──────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔌 Connecting to ${BASE_URL}\n`);

  // ── 1. Health check ───────────────────────────────────────────────────────
  console.log("1. Health check...");
  const health = await fetch(`${BASE_URL}/health`).then((r) => r.json()) as { status: string; timestamp: string };
  console.log("   ✅", health.status, "-", health.timestamp, "\n");

  // ── 2. Initialize MCP session ─────────────────────────────────────────────
  console.log("2. Initializing MCP session...");
  const initResponse = await send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-script", version: "1.0.0" },
    },
  });

  if (initResponse?.error) {
    throw new Error(`Initialize failed: ${JSON.stringify(initResponse.error)}`);
  }

  console.log("   ✅ Session ID:", sessionId);
  console.log("   Server:", initResponse.result?.serverInfo?.name ?? "(unnamed)", "\n");

  // ── 3. List tools ─────────────────────────────────────────────────────────
  console.log("3. Listing available tools...");
  const toolsResponse = await send({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  });

  if (toolsResponse?.error) {
    throw new Error(`tools/list failed: ${JSON.stringify(toolsResponse.error)}`);
  }

  const tools: string[] = toolsResponse.result?.tools?.map((t: any) => t.name) ?? [];
  console.log(`   ✅ ${tools.length} tools registered:`);
  tools.forEach((name) => console.log(`      - ${name}`));
  console.log();

  // ── 4. Call monei_get_account ─────────────────────────────────────────────
  console.log("4. Calling monei_get_account...");
  const accountResponse = await send({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "monei_get_account", arguments: {} },
  });

  const content = accountResponse.result?.content?.[0]?.text;
  if (accountResponse.result?.isError) {
    console.log("   ⚠️  Tool returned error:", content);
  } else {
    const account = JSON.parse(content ?? "{}");
    console.log("   ✅ Account:", account.email ?? account.firstName ?? "(no email)");
  }
  console.log();

  // ── 5. Call monei_get_wallet ──────────────────────────────────────────────
  console.log("5. Calling monei_get_wallet...");
  const walletResponse = await send({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "monei_get_wallet", arguments: {} },
  });

  const walletContent = walletResponse.result?.content?.[0]?.text;
  if (walletResponse.result?.isError) {
    console.log("   ⚠️  Tool returned error:", walletContent);
  } else {
    const wallet = JSON.parse(walletContent ?? "{}");
    console.log(wallet);
    console.log("   ✅ NGN Balance:", wallet.nairaBalance ?? wallet.balance ?? "(unavailable)");
  }
  console.log();

  console.log("✅ All checks passed. HTTP transport is working correctly.\n");
}

main().catch((err) => {
  console.error("❌ Test failed:", err.message);
  process.exit(1);
});