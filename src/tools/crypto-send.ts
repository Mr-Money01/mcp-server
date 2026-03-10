import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createClient } from "../client.js";
import { toMcpError } from "../errors.js";
import { SendCryptoEvmSchema } from "../schemas/evm.schema.js";
import { SendCryptoSolanaSchema } from "../schemas/solana.schema.js";

export function registerCryptoSendTools(server: McpServer, apiKey?: string): void {

  // ─── send_crypto_evm ──────────────────────────────────────────────────────
  server.registerTool(
    "monei_send_crypto_evm",
    {
      title: "Send Crypto (EVM)",
      description: `Sends cryptocurrency from the user's Monei EVM wallet to an external wallet address.

Handles both native tokens (ETH, BNB, MATIC) and ERC-20 tokens (USDT, USDC) with a single tool.
Routing is automatic: if tokenAddress is provided it sends the ERC-20, otherwise it sends the native token.

Before calling:
1. Confirm sufficient balance using monei_get_evm_portfolio for the relevant chain
2. Ask for the user's transaction PIN if not already provided — never store or log it
3. Show the recipient address and amount to the user and get explicit confirmation before sending

Args:
  - to (string): Recipient EVM wallet address (0x...)
  - amount (string): Amount to send as a string to avoid floating point errors
  - chainId (number): Chain to send on (56=BSC, 137=Polygon, 8453=Base, 1=Ethereum, etc.)
  - tokenAddress (string, optional): ERC-20 contract address — omit for native tokens (ETH/BNB/MATIC)
  - transactionPin (string): User's 4-6 digit PIN — ask at runtime, never store

Returns:
{
  "txHash": string,        // Transaction hash to track on the block explorer
  "amount": string,
  "to": string,
  "chainId": number
}

Examples:
  - "Send 0.01 ETH to 0x742d..." -> chainId: 1, amount: "0.01", no tokenAddress
  - "Send 100 USDT on BSC to 0x..." -> chainId: 56, amount: "100", tokenAddress: USDT contract on BSC
  - "Send 50 MATIC to 0x..." -> chainId: 137, amount: "50", no tokenAddress

Security: Never log or store the transactionPin.`,
      inputSchema: SendCryptoEvmSchema,
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
        let response;

        if (params.tokenAddress) {
          // ERC-20 token send
          response = await sdk.evm.sendToken({
            to: params.to,
            tokenAddress: params.tokenAddress,
            amount: params.amount,
            chainId: params.chainId,
            //transactionPin: params.transactionPin,
          });
        } else {
          // Native token send (ETH, BNB, MATIC, etc.)
          response = await sdk.evm.sendNativeToken({
            to: params.to,
            amount: params.amount,
            chainId: params.chainId,
            //transactionPin: params.transactionPin,
          });
        }

        const data = response.data;
        const output = {
          txHash: data.txHash,
          //status: data.status,
          amount: params.amount,
          //token: data.token ?? (params.tokenAddress ? "ERC-20" : "Native"),
          to: params.to,
          chainId: params.chainId,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        return toMcpError(error, "monei_send_crypto_evm");
      }
    }
  );

  // ─── send_crypto_solana ───────────────────────────────────────────────────
  server.registerTool(
    "monei_send_crypto_solana",
    {
      title: "Send Crypto (Solana)",
      description: `Sends cryptocurrency from the user's Monei Solana wallet to an external wallet address.

Handles both native SOL and SPL tokens (USDC, USDT on Solana) with a single tool.
Routing is automatic: if tokenMintAddress is provided it sends the SPL token, otherwise it sends SOL.

Before calling:
1. Confirm sufficient balance using monei_get_solana_portfolio
2. Ask for the user's transaction PIN if not already provided — never store or log it
3. Show the recipient address and amount to the user and get explicit confirmation before sending

Args:
  - to (string): Recipient Solana wallet address (base58 encoded)
  - amount (string): Amount to send as a string
  - network (string, optional): "mainnet-beta" (default), "devnet", or "testnet"
  - tokenMintAddress (string, optional): SPL token mint address — omit to send native SOL
  - transactionPin (string): User's 4-6 digit PIN — ask at runtime, never store

Returns:
{
  "signature": string,     // Solana transaction signature
  "status": string,
  "amount": string,
  "token": string,         // "SOL" or the SPL token symbol
  "to": string,
  "network": string
}

Examples:
  - "Send 2 SOL to 5AH3..." -> amount: "2", no tokenMintAddress
  - "Send 50 USDC on Solana to 5AH3..." -> amount: "50", tokenMintAddress: USDC mint address on Solana

Security: Never log or store the transactionPin.`,
      inputSchema: SendCryptoSolanaSchema,
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
        let response;

        if (params.tokenMintAddress) {
          // SPL token send
          response = await sdk.solana.sendToken({
            to: params.to,
            tokenMintAddress: params.tokenMintAddress,
            amount: params.amount,
            network: params.network,
            //transactionPin: params.transactionPin,
          });
        } else {
          // Native SOL send
          response = await sdk.solana.sendNativeToken({
            to: params.to,
            amount: params.amount,
            network: params.network,
            //transactionPin: params.transactionPin,
          });
        }

        const data = response.data;
        const output = {
          signature: data.signature,
          //status: data.status,
          amount: params.amount,
          //token: data.token ?? (params.tokenMintAddress ? "SPL Token" : "SOL"),
          to: params.to,
          network: params.network ?? "mainnet-beta",
        };

        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        return toMcpError(error, "monei_send_crypto_solana");
      }
    }
  );
}