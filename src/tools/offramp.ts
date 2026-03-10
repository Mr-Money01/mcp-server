import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createClient } from "../client.js";
import { toMcpError } from "../errors.js";
import {
  GetOfframpQuoteSchema,
  SellCryptoForNairaSchema,
  TrackOfframpSchema,
} from "../schemas/offramp.schema.js";
import { OfframpAssets, OfframpNetworks, OfframpCurrency } from "monei-sdk";

export function registerOfframpTools(server: McpServer, apiKey?: string): void {

  // ─── monei_get_offramp_quote ──────────────────────────────────────────────
  server.registerTool(
    "monei_get_offramp_quote",
    {
      title: "Get Offramp Quote",
      description: `Gets the current exchange rate and expected NGN payout for selling a specific amount of crypto.

Call this before monei_sell_crypto_for_naira to show the user the rate and how much NGN they will receive. The rate is live — it will be locked when the sell is actually initiated.

Args:
  - token (string): Token to sell — "USDT", "USDC", or "CNGN"
  - network (string): Network the token is on — "base", "polygon", "arbitrum-one", "bnb-smart-chain", "ethereum", "optimism", "lisk", "scroll", "starknet"
  - amount (number): Amount of the token to sell (e.g. 100 for 100 USDT)
  - fiat (string, optional): Fiat to receive — defaults to "NGN"

Returns:
{
  "token": string,
  "network": string,
  "amount": number,
  "fiat": string,
  "rate": string | number   // Exchange rate data returned by the API
}

Examples:
  - "What's the rate for selling 100 USDT on Base?" -> token: "USDT", network: "base", amount: 100
  - "How much naira will I get for 50 USDC on Polygon?" -> token: "USDC", network: "polygon", amount: 50`,
      inputSchema: GetOfframpQuoteSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const sdk = createClient(apiKey);
        const response = await sdk.offrampExchange.getQuote({
          token: params.token as OfframpAssets,
          network: params.network as OfframpNetworks,
          amount: params.amount,
          fiat: (params.fiat ?? "NGN") as OfframpCurrency,
        });

        const output = {
          token: params.token,
          network: params.network,
          amount: params.amount,
          fiat: params.fiat ?? "NGN",
          rate: response.data,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        return toMcpError(error, "monei_get_offramp_quote");
      }
    }
  );

  // ─── monei_sell_crypto_for_naira ──────────────────────────────────────────
  server.registerTool(
    "monei_sell_crypto_for_naira",
    {
      title: "Sell Crypto for Naira",
      description: `Sells cryptocurrency and sends the NGN proceeds to a Nigerian bank account.

Handles the complete offramp flow: takes the token details, fiat currency, and destination bank account, then initiates the swap.

Before calling this tool:
1. Check the user has sufficient balance using monei_get_evm_portfolio or monei_get_wallet
2. Call monei_get_offramp_quote to show the user the current rate and expected NGN amount
3. Call monei_verify_bank_account to get the account holder name — pass that name as accountName
4. Show the verified account name, rate, and expected payout to the user and get explicit confirmation

Args:
  - amount (number): Amount of token to sell (e.g. 100 for 100 USDT)
  - token (string): Token to sell — "USDT", "USDC", or "CNGN"
  - network (string): Network the token is on — "base", "polygon", "arbitrum-one", "bnb-smart-chain", "ethereum", "optimism", "lisk", "scroll", "starknet"
  - fiatCurrency (string): Fiat to receive — defaults to "NGN"
  - bankCode (string): Destination bank code from monei_get_banks
  - accountNumber (string): Destination 10-digit bank account number
  - accountName (string): Account holder name from monei_verify_bank_account

Returns:
{
  "id": string,
  "reference": string,        // Use with monei_track_offramp to monitor progress
  "status": string,           // Initial status e.g. "initiated" or "awaiting_deposit"
  "amounts": object,          // Crypto and fiat amounts with exchange rate and fees
  "beneficiary": object,      // Destination bank details
  "onChain": object,          // Deposit address and on-chain details
  "timestamps": object
}

After initiating, tell the user their reference and that settlement typically takes 5–10 minutes.
Use monei_track_offramp to check progress.`,
      inputSchema: SellCryptoForNairaSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const sdk = createClient(apiKey);
        const response = await sdk.offrampExchange.initiateSwap({
          amount: params.amount,
          token: params.token as OfframpAssets,
          network: params.network as OfframpNetworks,
          fiatCurrency: (params.fiatCurrency ?? "NGN") as OfframpCurrency,
          bankCode: params.bankCode,
          accountNumber: params.accountNumber,
          accountName: params.accountName,
        });

        const data = response.data;
        const output = {
          id: data.id,
          reference: data.reference,
          status: data.status,
          amounts: data.amounts,
          beneficiary: data.beneficiary,
          onChain: data.onChain,
          failureReason: data.failureReason ?? null,
          timestamps: data.timestamps,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        return toMcpError(error, "monei_sell_crypto_for_naira");
      }
    }
  );

  // ─── monei_track_offramp ──────────────────────────────────────────────────
  server.registerTool(
    "monei_track_offramp",
    {
      title: "Track Offramp",
      description: `Checks the current status of an offramp transaction by its reference.

Use this after monei_sell_crypto_for_naira to monitor settlement. Most transactions complete within 5–10 minutes. Poll every 30–60 seconds if the user is waiting.

Possible statuses: initiated, quote_created, awaiting_deposit, deposit_received, pending, processing, fiat_sent, completed, failed, cancelled, refunded, expired.

Args:
  - reference (string): The reference returned from monei_sell_crypto_for_naira

Returns:
{
  "id": string,
  "reference": string,
  "status": string,
  "cryptoAmount": number,
  "fiatAmount": number,
  "exchangeRate": number,
  "fromCurrency": string,
  "toCurrency": string,
  "createdAt": string,
  "updatedAt": string,
  "completedAt": string | null
}

Examples:
  - "What's the status of my USDT sale?" -> call with the reference from the sell
  - "Did my offramp complete?" -> check status field — "completed" means NGN has been sent`,
      inputSchema: TrackOfframpSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ reference }) => {
      try {
        const sdk = createClient(apiKey);
        const response = await sdk.offrampLedger.trackOrder({ reference });
        const data = response.data;

        const output = {
          id: data.id,
          reference: data.reference,
          status: data.status,
          cryptoAmount: data.cryptoAmount,
          fiatAmount: data.fiatAmount,
          exchangeRate: data.exchangeRate,
          fromCurrency: data.fromCurrency,
          toCurrency: data.toCurrency,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          completedAt: data.completedAt ?? null,
          failureReason: data.debitPaymentDetails ?? null,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        return toMcpError(error, "monei_track_offramp");
      }
    }
  );
}