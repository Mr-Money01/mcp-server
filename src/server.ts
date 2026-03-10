import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAccountTools } from "./tools/account.js";
import { registerWalletTools } from "./tools/wallet.js";
import { registerBankingTools } from "./tools/banking.js";
import { registerTransactionTools } from "./tools/transactions.js";
import { registerDepositTools } from "./tools/deposits.js";
import { registerPayoutTools } from "./tools/payout.js";
import { registerBillsTools } from "./tools/bills.js";
import { registerCryptoSendTools } from "./tools/crypto-send.js";
import { registerOfframpTools } from "./tools/offramp.js";
import { registerSwapTools } from "./tools/swap.js";
import { getEnvMode } from "./client.js";

/**
 * Creates and configures the McpServer instance with all registered tools.
 *
 * apiKey is optional here:
 *  - stdio mode:     not passed — each tool reads from process.env at call time
 *  - http/sse mode:  passed from the Authorization header — scoped per user
 */
export function createServer(apiKey?: string): McpServer {
  const env = getEnvMode();

  console.error(`[monei-mcp] Starting in ${env.toUpperCase()} mode`);

  if (!apiKey && !process.env.MONEI_API_KEY) {
    console.error("[monei-mcp] WARNING: No API key available. Tools will fail until a key is provided.");
  }

  const server = new McpServer({
    name: "monei-mcp-server",
    version: "1.0.0",
  });

  // Phase 1: read-only
  registerAccountTools(server, apiKey);
  registerWalletTools(server, apiKey);
  registerBankingTools(server, apiKey);
  registerTransactionTools(server, apiKey);

  // Phase 2: deposits and NGN payouts
  registerDepositTools(server, apiKey);
  registerPayoutTools(server, apiKey);

  // Phase 3: crypto sends and offramp
  registerCryptoSendTools(server, apiKey);
  registerOfframpTools(server, apiKey);

  // Phase 4: swaps and bills
  registerSwapTools(server, apiKey);
  registerBillsTools(server, apiKey);

  return server;
}