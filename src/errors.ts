import { z } from "zod";

// ─── MCP error result type ────────────────────────────────────────────────────

export type McpErrorResult = {
  isError: true;
  content: [{ type: "text"; text: string }];
};

// ─── SDK error classification ─────────────────────────────────────────────────

/**
 * The SDK uses axios under the hood. Axios errors have a response property
 * with status and data. We check for that shape without importing axios directly.
 */
function isAxiosError(error: unknown): error is {
  response?: {
    status: number;
    data?: {
      message?: string;
      error?: string;
      errors?: Record<string, string[]>;
      statusCode?: number;
    };
  };
  code?: string;
  message: string;
} {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    ("response" in error || "code" in error)
  );
}

/**
 * Returns true if this error is a rate limit (429) response.
 * Used by withRetry() to decide whether to retry.
 */
export function isRateLimitError(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 429;
}

/**
 * Returns true if this error is a network timeout or connection error.
 * Used by withRetry() to decide whether to retry.
 */
export function isRetryableError(error: unknown): boolean {
  if (isRateLimitError(error)) return true;
  if (isAxiosError(error)) {
    // Retry on network errors and 5xx server errors
    const code = (error as any).code;
    const status = error.response?.status;
    return (
      code === "ECONNRESET" ||
      code === "ETIMEDOUT" ||
      code === "ENOTFOUND" ||
      (status !== undefined && status >= 500 && status < 600)
    );
  }
  return false;
}

// ─── Error message extraction ─────────────────────────────────────────────────

/**
 * Extracts the most informative error message from an SDK/axios error.
 *
 * Priority:
 *  1. API error message from response body
 *  2. Validation errors from response body
 *  3. HTTP status + generic message
 *  4. Network error code
 *  5. Error.message
 */
function extractErrorMessage(error: unknown): string {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    const data = error.response?.data;

    if (status !== undefined) {
      // Extract the most useful message from the response body
      const apiMessage = data?.message ?? data?.error;

      // Validation errors — flatten into readable list
      if (data?.errors && typeof data.errors === "object") {
        const validationMessages = Object.entries(data.errors)
          .map(([field, msgs]) =>
            Array.isArray(msgs) ? `${field}: ${msgs.join(", ")}` : `${field}: ${msgs}`
          )
          .join("; ");
        return `Validation failed — ${validationMessages}`;
      }

      // Map status codes to helpful messages
      switch (status) {
        case 400:
          return apiMessage
            ? `Bad request — ${apiMessage}`
            : "Bad request — check your input and try again";
        case 401:
          return "Authentication failed — your API key is invalid or expired";
        case 403:
          return apiMessage
            ? `Permission denied — ${apiMessage}`
            : "Permission denied — your account does not have access to this feature";
        case 404:
          return apiMessage
            ? `Not found — ${apiMessage}`
            : "Resource not found";
        case 409:
          return apiMessage
            ? `Conflict — ${apiMessage}`
            : "Request conflicts with the current state (duplicate transaction?)";
        case 422:
          return apiMessage
            ? `Unprocessable — ${apiMessage}`
            : "Request could not be processed — check your input";
        case 429:
          return "Rate limit exceeded — please wait a moment before trying again";
        case 500:
          return "Monei API server error — please try again in a moment";
        case 502:
        case 503:
        case 504:
          return "Monei API is temporarily unavailable — please try again shortly";
        default:
          return apiMessage
            ? `API error (${status}) — ${apiMessage}`
            : `API error (${status})`;
      }
    }

    // Network errors (no response)
    switch (error.code) {
      case "ECONNRESET":
        return "Connection was reset — please try again";
      case "ETIMEDOUT":
        return "Request timed out — the API is taking too long to respond";
      case "ENOTFOUND":
        return "Could not reach the Monei API — check your network connection";
      default:
        return `Network error — ${sanitise(error.message)}`;
    }
  }

  if (error instanceof Error) {
    return sanitise(error.message);
  }

  return "An unexpected error occurred — please try again";
}

// ─── Sanitiser ────────────────────────────────────────────────────────────────

/**
 * Strips API keys, internal URLs, and stack traces from any string
 * before it reaches the agent.
 */
function sanitise(message: string): string {
  // Redact anything that looks like an API key (32+ char alphanumeric)
  let cleaned = message.replace(/[a-zA-Z0-9_-]{32,}/g, "[REDACTED]");
  // Redact internal URLs
  cleaned = cleaned.replace(/https?:\/\/[^\s]+/g, "[URL]");
  // Truncate
  if (cleaned.length > 400) cleaned = cleaned.slice(0, 397) + "...";
  return cleaned;
}

// ─── toMcpError ───────────────────────────────────────────────────────────────

/**
 * Converts any caught error into a typed MCP tool error result.
 *
 * The agent receives isError: true and a clear human-readable message.
 * No stack traces, API keys, or internal URLs ever reach the agent.
 */
export function toMcpError(error: unknown, context?: string): McpErrorResult {
  const prefix = context ? `[${context}] ` : "";

  // Zod validation errors — input didn't pass schema
  if (error instanceof z.ZodError) {
    const issues = error.issues
      .map((i) => `  - ${i.path.join(".") || "input"}: ${i.message}`)
      .join("\n");
    return {
      isError: true,
      content: [{ type: "text", text: `${prefix}Invalid input:\n${issues}` }],
    };
  }

  // No API key
  if (
    error instanceof Error &&
    error.message.includes("No Monei API key")
  ) {
    return {
      isError: true,
      content: [{
        type: "text",
        text: `${prefix}No API key configured. Set MONEI_API_KEY in your environment or pass it via the Authorization header.`,
      }],
    };
  }

  const message = extractErrorMessage(error);
  return {
    isError: true,
    content: [{ type: "text", text: `${prefix}${message}` }],
  };
}

// ─── withRetry ────────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

/**
 * Wraps an async SDK call with exponential backoff retry logic.
 *
 * Retries on:
 *  - 429 rate limit errors
 *  - 5xx server errors
 *  - Network errors (ECONNRESET, ETIMEDOUT, ENOTFOUND)
 *
 * Does NOT retry on:
 *  - 4xx client errors (bad input, auth failures, etc.)
 *  - Zod validation errors
 *
 * Delays: 500ms, 1000ms, 2000ms (exponential with jitter)
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  context: string
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (!isRetryableError(error) || attempt === MAX_RETRIES) {
        throw error;
      }

      // Exponential backoff with jitter: 500ms, 1000ms, 2000ms ± 10%
      const baseDelay = BASE_DELAY_MS * Math.pow(2, attempt);
      const jitter = baseDelay * 0.1 * (Math.random() * 2 - 1);
      const delay = Math.round(baseDelay + jitter);

      const isRateLimit = isRateLimitError(error);
      console.error(
        `[monei-mcp:${context}] ${isRateLimit ? "Rate limited" : "Retryable error"} — ` +
        `retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`
      );

      await sleep(delay);
    }
  }

  throw lastError;
}

// ─── safeExecute ─────────────────────────────────────────────────────────────

/**
 * Wraps an async tool handler with retry logic and error formatting.
 * Every tool call should go through this.
 */
export async function safeExecute<T>(
  fn: () => Promise<T>,
  context: string
): Promise<T | McpErrorResult> {
  try {
    return await withRetry(fn, context);
  } catch (error) {
    return toMcpError(error, context);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}