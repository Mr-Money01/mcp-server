import * as http from "node:http";
import * as crypto from "node:crypto";

// ─── In-memory stores (replace with Redis/DB for multi-instance) ──────────────

interface OAuthClient {
  clientId: string;
  clientSecret: string;
  redirectUris: string[];
  clientName: string;
  createdAt: number;
}

interface AuthCode {
  code: string;
  clientId: string;
  redirectUri: string;
  apiKey: string;
  expiresAt: number;
}

interface AccessToken {
  token: string;
  apiKey: string;
  clientId: string;
  expiresAt: number;
  refreshToken: string;
}

const clients = new Map<string, OAuthClient>();
const authCodes = new Map<string, AuthCode>();
const accessTokens = new Map<string, AccessToken>();
const refreshTokens = new Map<string, string>(); // refreshToken → accessToken

const TOKEN_TTL = 60 * 60 * 1000; // 1 hour
const CODE_TTL = 10 * 60 * 1000;  // 10 minutes
const BASE_URL = process.env.MCP_BASE_URL ?? "https://mcp.monei.cc";
const BACKEND_BASE = "https://api.monei.cc";

// ─── Validate API key against Monei backend ───────────────────────────────────

async function validateApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const res = await fetch(`${BACKEND_BASE}/api/v1/user/me`, {
      method: "GET",
      headers: { "X-API-KEY": apiKey },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return { valid: true };
    if (res.status === 401 || res.status === 403) {
      return { valid: false, error: "Invalid API key. Please check and try again." };
    }
    return { valid: false, error: `Monei returned an unexpected error (${res.status}). Try again.` };
  } catch (err: any) {
    if (err?.name === "TimeoutError") {
      return { valid: false, error: "Connection to Monei timed out. Please try again." };
    }
    return { valid: false, error: "Could not reach Monei servers. Check your connection and try again." };
  }
}

// ─── Cleanup expired tokens every 10 minutes ─────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of authCodes) if (v.expiresAt < now) authCodes.delete(k);
  for (const [k, v] of accessTokens) if (v.expiresAt < now) {
    refreshTokens.delete(v.refreshToken);
    accessTokens.delete(k);
  }
}, 10 * 60 * 1000);

// ─── Token lookup (used by SSE/HTTP transport) ────────────────────────────────

export function getApiKeyFromToken(token: string): string | null {
  const entry = accessTokens.get(token);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    accessTokens.delete(token);
    return null;
  }
  return entry.apiKey;
}

// ─── OAuth endpoint router ────────────────────────────────────────────────────

export function createOAuthListener(): (
  req: http.IncomingMessage,
  res: http.ServerResponse
) => boolean {
  return (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    // OAuth discovery
    if (req.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
      return handle(handleDiscovery, req, res);
    }
    // Dynamic client registration
    if (req.method === "POST" && url.pathname === "/oauth/register") {
      return handle(handleRegister, req, res);
    }
    // Authorization page
    if (req.method === "GET" && url.pathname === "/oauth/authorize") {
      return handle(handleAuthorizeGet, req, res);
    }
    if (req.method === "POST" && url.pathname === "/oauth/authorize") {
      return handle(handleAuthorizePost, req, res);
    }
    // Token exchange
    if (req.method === "POST" && url.pathname === "/oauth/token") {
      return handle(handleToken, req, res);
    }
    // Userinfo
    if (req.method === "GET" && url.pathname === "/oauth/userinfo") {
      return handle(handleUserinfo, req, res);
    }

    return false;
  };
}

function handle(
  fn: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>,
  req: http.IncomingMessage,
  res: http.ServerResponse
): true {
  fn(req, res).catch((err) => {
    console.error("[monei-mcp:oauth] Error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "server_error" }));
    }
  });
  return true;
}

// ─── Read request body ────────────────────────────────────────────────────────

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function parseBody(raw: string, contentType?: string): Record<string, string> {
  if (contentType?.includes("application/json")) {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  // application/x-www-form-urlencoded
  return Object.fromEntries(new URLSearchParams(raw));
}

// ─── 1. Discovery ─────────────────────────────────────────────────────────────

async function handleDiscovery(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const metadata = {
    issuer: BASE_URL,
    authorization_endpoint: `${BASE_URL}/oauth/authorize`,
    token_endpoint: `${BASE_URL}/oauth/token`,
    userinfo_endpoint: `${BASE_URL}/oauth/userinfo`,
    registration_endpoint: `${BASE_URL}/oauth/register`,
    // Tell Claude.ai where the MCP SSE endpoint lives
    mcp_endpoint: `${BASE_URL}/sse`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: [
      "client_secret_post",
      "client_secret_basic",
      "none",
    ],
    scopes_supported: ["openid", "profile"],
  };

  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(metadata));
}

// ─── 2. Dynamic Client Registration ──────────────────────────────────────────

async function handleRegister(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const raw = await readBody(req);
  const body = parseBody(raw, req.headers["content-type"]);

  const clientId = crypto.randomUUID();
  const clientSecret = crypto.randomBytes(32).toString("hex");
  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris
    : [body.redirect_uris].filter(Boolean);

  const client: OAuthClient = {
    clientId,
    clientSecret,
    redirectUris,
    clientName: body.client_name ?? "Unknown Client",
    createdAt: Date.now(),
  };

  clients.set(clientId, client);
  console.error(`[monei-mcp:oauth] Registered client: ${client.clientName} (${clientId})`);

  res.writeHead(201, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    client_id: clientId,
    client_secret: clientSecret,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_secret_expires_at: 0,
    redirect_uris: redirectUris,
    client_name: client.clientName,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  }));
}

// ─── 3. Authorization page ────────────────────────────────────────────────────

function renderAuthPage(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  error?: string;
}): string {
  const { clientId, redirectUri, state, codeChallenge, codeChallengeMethod, error } = params;
  const errorHtml = error
    ? `<div class="error">${escHtml(error)}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connect Mr.Monei</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0a0a0a;
      color: #fff;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #111;
      border: 1px solid #222;
      border-radius: 16px;
      padding: 40px;
      width: 100%;
      max-width: 420px;
    }
    .logo {
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.5px;
      margin-bottom: 8px;
    }
    .tagline {
      color: #666;
      font-size: 14px;
      margin-bottom: 32px;
    }
    h1 {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 8px;
    }
    p {
      color: #888;
      font-size: 14px;
      line-height: 1.5;
      margin-bottom: 24px;
    }
    label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: #aaa;
      margin-bottom: 8px;
    }
    input {
      width: 100%;
      padding: 12px 14px;
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 8px;
      color: #fff;
      font-size: 14px;
      font-family: monospace;
      margin-bottom: 24px;
      outline: none;
      transition: border-color 0.15s;
    }
    input:focus { border-color: #555; }
    input::placeholder { color: #444; }
    button {
      width: 100%;
      padding: 12px;
      background: #fff;
      color: #000;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    button:hover { opacity: 0.9; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .error {
      background: #1f0a0a;
      border: 1px solid #5c1a1a;
      color: #f87171;
      border-radius: 8px;
      padding: 12px 14px;
      font-size: 13px;
      margin-bottom: 20px;
      line-height: 1.5;
    }
    .footer {
      margin-top: 24px;
      text-align: center;
      font-size: 12px;
      color: #444;
    }
    .footer a { color: #666; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Mr. Monei</div>
    <div class="tagline">Financial AI for the autonomous economy</div>
    <h1>Connect your Monei account</h1>
    <p>Enter your Monei API key to give access to Mr. Monei</p>
    ${errorHtml}
    <form method="POST" action="/oauth/authorize" onsubmit="handleSubmit(event)">
      <input type="hidden" name="client_id" value="${escHtml(clientId)}">
      <input type="hidden" name="redirect_uri" value="${escHtml(redirectUri)}">
      <input type="hidden" name="state" value="${escHtml(state)}">
      <input type="hidden" name="code_challenge" value="${escHtml(codeChallenge)}">
      <input type="hidden" name="code_challenge_method" value="${escHtml(codeChallengeMethod)}">
      <label for="api_key">Monei API Key</label>
      <input
        type="password"
        id="api_key"
        name="api_key"
        placeholder="mk_live_..."
        autocomplete="off"
        required
      >
      <button type="submit" id="submit-btn">Authorize</button>
    </form>
    <div class="footer">
      <a href="https://monei.cc" target="_blank">monei.cc</a> · 
      <a href="https://docs.monei.cc" target="_blank">Docs</a>
    </div>
  </div>
  <script>
    function handleSubmit(e) {
      const btn = document.getElementById('submit-btn');
      btn.disabled = true;
      btn.textContent = 'Verifying...';
    }
  </script>
</body>
</html>`;
}

async function handleAuthorizeGet(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const clientId = url.searchParams.get("client_id") ?? "";
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const codeChallenge = url.searchParams.get("code_challenge") ?? "";
  const codeChallengeMethod = url.searchParams.get("code_challenge_method") ?? "";
  const errorMsg = url.searchParams.get("error_msg") ?? undefined;

  const html = renderAuthPage({ clientId, redirectUri, state, codeChallenge, codeChallengeMethod, error: errorMsg });

  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(html);
}

async function handleAuthorizePost(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const raw = await readBody(req);
  const body = parseBody(raw, "application/x-www-form-urlencoded");

  const { client_id, redirect_uri, state, api_key, code_challenge, code_challenge_method } = body;

  const renderError = (error: string) => {
    const html = renderAuthPage({
      clientId: client_id ?? "",
      redirectUri: redirect_uri ?? "",
      state: state ?? "",
      codeChallenge: code_challenge ?? "",
      codeChallengeMethod: code_challenge_method ?? "",
      error,
    });
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end(html);
  };

  if (!api_key?.trim()) {
    return renderError("API key is required.");
  }

  // ── Validate the API key against Monei backend before issuing auth code ──
  console.error(`[monei-mcp:oauth] Validating API key for client ${client_id}`);
  const validation = await validateApiKey(api_key.trim());

  if (!validation.valid) {
    console.error(`[monei-mcp:oauth] API key validation failed: ${validation.error}`);
    return renderError(validation.error ?? "Invalid API key.");
  }

  // Key is valid — generate auth code
  const code = crypto.randomBytes(32).toString("hex");
  authCodes.set(code, {
    code,
    clientId: client_id,
    redirectUri: redirect_uri,
    apiKey: api_key.trim(),
    expiresAt: Date.now() + CODE_TTL,
  });

  console.error(`[monei-mcp:oauth] API key valid — auth code issued for client ${client_id}`);

  // Redirect back to Claude
  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set("code", code);
  if (state) redirectUrl.searchParams.set("state", state);

  res.writeHead(302, { Location: redirectUrl.toString() });
  res.end();
}

// ─── 4. Token exchange ────────────────────────────────────────────────────────

async function handleToken(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const raw = await readBody(req);
  const body = parseBody(raw, req.headers["content-type"]);

  const grantType = body.grant_type;

  if (grantType === "authorization_code") {
    const { code, client_id } = body;

    const authCode = authCodes.get(code);
    if (!authCode) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_grant", error_description: "Auth code not found or expired" }));
      return;
    }

    if (authCode.expiresAt < Date.now()) {
      authCodes.delete(code);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_grant", error_description: "Auth code expired" }));
      return;
    }

    // Consume the code
    authCodes.delete(code);

    const accessToken = crypto.randomBytes(32).toString("hex");
    const refreshToken = crypto.randomBytes(32).toString("hex");

    accessTokens.set(accessToken, {
      token: accessToken,
      apiKey: authCode.apiKey,
      clientId: client_id ?? authCode.clientId,
      expiresAt: Date.now() + TOKEN_TTL,
      refreshToken,
    });
    refreshTokens.set(refreshToken, accessToken);

    console.error(`[monei-mcp:oauth] Access token issued for client ${client_id}`);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: TOKEN_TTL / 1000,
      refresh_token: refreshToken,
      scope: "openid profile",
    }));
    return;
  }

  if (grantType === "refresh_token") {
    const { refresh_token } = body;
    const existingAccessToken = refreshTokens.get(refresh_token);

    if (!existingAccessToken) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_grant", error_description: "Refresh token not found or expired" }));
      return;
    }

    const existing = accessTokens.get(existingAccessToken);
    if (!existing) {
      refreshTokens.delete(refresh_token);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_grant", error_description: "Session expired, please reconnect" }));
      return;
    }

    // Rotate tokens
    accessTokens.delete(existingAccessToken);
    refreshTokens.delete(refresh_token);

    const newAccessToken = crypto.randomBytes(32).toString("hex");
    const newRefreshToken = crypto.randomBytes(32).toString("hex");

    accessTokens.set(newAccessToken, {
      token: newAccessToken,
      apiKey: existing.apiKey,
      clientId: existing.clientId,
      expiresAt: Date.now() + TOKEN_TTL,
      refreshToken: newRefreshToken,
    });
    refreshTokens.set(newRefreshToken, newAccessToken);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      access_token: newAccessToken,
      token_type: "Bearer",
      expires_in: TOKEN_TTL / 1000,
      refresh_token: newRefreshToken,
      scope: "openid profile",
    }));
    return;
  }

  res.writeHead(400, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "unsupported_grant_type" }));
}

// ─── 5. Userinfo ──────────────────────────────────────────────────────────────

async function handleUserinfo(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const auth = req.headers["authorization"];
  const token = auth?.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    res.writeHead(401, {
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer realm="${BASE_URL}"`,
    });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

  const entry = accessTokens.get(token);
  if (!entry || entry.expiresAt < Date.now()) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid_token" }));
    return;
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    sub: entry.clientId,
    name: "Monei User",
  }));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}