import { MoneiSDK } from "monei-sdk";

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

export function getEnvMode(): "sandbox" | "live" {
  return process.env.MONEI_ENV === "live" ? "live" : "sandbox";
}