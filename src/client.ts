import MoneiSDK from "monei-sdk";

/**
 * Request timeout in milliseconds.
 * Configurable via MONEI_TIMEOUT env var. Default: 30 seconds.
 * Max enforced at 120 seconds to prevent indefinite hangs.
 */
function getTimeout(): number {
  const raw = process.env.MONEI_TIMEOUT;
  if (!raw) return 30_000;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed <= 0) {
    console.error(`[monei-mcp] Invalid MONEI_TIMEOUT value '${raw}', using default 30000ms`);
    return 30_000;
  }
  if (parsed > 120_000) {
    console.error(`[monei-mcp] MONEI_TIMEOUT ${parsed}ms exceeds max 120000ms, clamping`);
    return 120_000;
  }
  return parsed;
}

/**
 * Creates a MoneiSDK instance scoped to a single request.
 *
 * The server is stateless — we never cache SDK instances between calls.
 * Every tool invocation gets a fresh client from its own API key.
 *
 * Key resolution order:
 *  1. apiKey argument (from Authorization header in HTTP/SSE mode)
 *  2. MONEI_API_KEY environment variable (stdio / local dev mode)
 *
 * Environment:
 *  - MONEI_ENV=live    → production API
 *  - anything else     → sandbox (safe default, prevents accidental live txns)
 *
 * Timeout:
 *  - MONEI_TIMEOUT=<ms> → configurable, default 30s, max 120s
 */
export function createClient(apiKey?: string): MoneiSDK {
  const key = apiKey ?? process.env.MONEI_API_KEY;

  if (!key) {
    throw new Error(
      "No Monei API key found. Provide it via the MCP client config or set the MONEI_API_KEY environment variable."
    );
  }

  const isLive = process.env.MONEI_ENV === "live";
  const defaultUrl = "https://api.monei.cc";
  const baseUrl = isLive
    ? (process.env.MONEI_API_URL ?? defaultUrl)
    : (process.env.MONEI_SANDBOX_URL ?? defaultUrl);

  return new MoneiSDK({
    apiKey: key,
    baseUrl,
    timeout: getTimeout(),
  });
}

/**
 * Returns the current environment mode.
 * Used for logging — never for security decisions.
 */
export function getEnvMode(): "sandbox" | "live" {
  return process.env.MONEI_ENV === "live" ? "live" : "sandbox";
}