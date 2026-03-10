import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createClient } from "../client.js";
import { toMcpError } from "../errors.js";
import { SwapTokensEvmSchema, SwapTokensSolanaSchema } from "../schemas/exchange.schema.js";

export function registerSwapTools(server: McpServer, apiKey?: string): void {

  // ─── monei_swap_tokens_evm ────────────────────────────────────────────────
  server.registerTool(
    "monei_swap_tokens_evm",
    {
      title: "Swap Tokens (EVM)",
      description: `Swaps one token for another on an EVM network using the user's Monei wallet.

Routing is automatic based on which fields you provide:
  - No tokenIn + tokenOut provided  →  Native to ERC-20  (e.g. ETH → USDC)
  - tokenIn + tokenOut both provided →  ERC-20 to ERC-20  (e.g. USDC → USDT)
  - tokenIn provided + no tokenOut  →  ERC-20 to Native  (e.g. USDC → ETH)

Before calling:
1. Confirm the user has sufficient balance using monei_get_evm_portfolio
2. If the user doesn't know contract addresses, look them up from their portfolio token list
3. Show the user what they are swapping and get confirmation before executing

Args:
  - amount (string): Amount to swap. Native-to-token: native amount (e.g. '0.1'). Token swaps: tokenIn amount.
  - chainId (number): Chain to swap on. 56=BSC, 137=Polygon, 8453=Base, 1=Ethereum, 42161=Arbitrum, 10=Optimism
  - tokenIn (string, optional): ERC-20 contract address of token to sell. Omit for native token sells.
  - tokenOut (string, optional): ERC-20 contract address of token to buy. Omit for native token buys.
  - slippageBps (number, optional): Slippage tolerance in basis points. Default 50 (0.5%).

Returns:
{
  "txHash": string,     // Transaction hash — can be checked on the block explorer
  "amount": string,
  "chainId": number,
  "route": string       // Human-readable description of what was swapped
}

Examples:
  - "Swap 0.1 ETH for USDC on Base" -> amount: "0.1", chainId: 8453, tokenOut: USDC contract
  - "Swap 100 USDC for USDT on BSC" -> amount: "100", chainId: 56, tokenIn: USDC contract, tokenOut: USDT contract
  - "Swap 50 USDC for BNB" -> amount: "50", chainId: 56, tokenIn: USDC contract, no tokenOut`,
      inputSchema: SwapTokensEvmSchema,
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
        let route: string;

        if (!params.tokenIn && params.tokenOut) {
          // Native → ERC-20
          response = await sdk.exchange.swapNativeToToken({
            amount: params.amount,
            tokenOut: params.tokenOut,
            chainId: params.chainId as number,
          });
          route = `Native → ${params.tokenOut}`;
        } else if (params.tokenIn && params.tokenOut) {
          // ERC-20 → ERC-20
          response = await sdk.exchange.swapTokenToToken({
            tokenIn: params.tokenIn,
            tokenOut: params.tokenOut,
            amount: params.amount,
            chainId: params.chainId as number,
          });
          route = `${params.tokenIn} → ${params.tokenOut}`;
        } else if (params.tokenIn && !params.tokenOut) {
          // ERC-20 → Native
          response = await sdk.exchange.swapTokenToNative({
            amount: params.amount,
            tokenIn: params.tokenIn,
            chainId: params.chainId as number,
          });
          route = `${params.tokenIn} → Native`;
        } else {
          return {
            isError: true,
            content: [{
              type: "text" as const,
              text: "Invalid swap configuration: provide at least tokenIn or tokenOut (or both). Cannot swap native to native.",
            }],
          };
        }

        const output = {
          txHash: response.data.txHash,
          amount: params.amount,
          chainId: params.chainId,
          route,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        return toMcpError(error, "monei_swap_tokens_evm");
      }
    }
  );

  // ─── monei_swap_tokens_solana ─────────────────────────────────────────────
  server.registerTool(
    "monei_swap_tokens_solana",
    {
      title: "Swap Tokens (Solana)",
      description: `Swaps one token for another on Solana using the user's Monei wallet.

Routing is automatic based on which fields you provide:
  - outputMint provided + no inputMint  →  SOL to SPL token  (e.g. SOL → USDC)
  - inputMint + outputMint both provided →  SPL to SPL token  (e.g. USDC → USDT)
  - inputMint provided + no outputMint  →  SPL token to SOL  (e.g. USDC → SOL)

Before calling:
1. Confirm the user has sufficient balance using monei_get_solana_portfolio
2. Mint addresses for common tokens: USDC = EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v, USDT = Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB
3. Show the user what they are swapping and get confirmation before executing

Args:
  - amount (number|string): Amount to swap. SOL-to-token: number (e.g. 1). Token-to-SOL: string (e.g. '100'). Token-to-token: number.
  - inputMint (string, optional): Mint address of the SPL token to sell. Omit when selling SOL.
  - outputMint (string, optional): Mint address of the SPL token to buy. Omit when buying SOL.
  - slippageBps (number, optional): Slippage tolerance in basis points. Default 50 (0.5%).

Returns:
{
  "signature": string,  // Solana transaction signature
  "txUrl": string,      // Explorer URL to view the transaction
  "route": string       // Human-readable description of what was swapped
}

Examples:
  - "Swap 1 SOL for USDC" -> amount: 1, outputMint: USDC mint, no inputMint
  - "Swap 100 USDC for SOL" -> amount: "100", inputMint: USDC mint, no outputMint
  - "Swap 50 USDC for USDT on Solana" -> amount: 50, inputMint: USDC mint, outputMint: USDT mint`,
      inputSchema: SwapTokensSolanaSchema,
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
        let route: string;

        const slippageBps = params.slippageBps ?? 50;

        if (!params.inputMint && params.outputMint) {
          // SOL → SPL token
          response = await sdk.exchange.swapSolToToken({
            outputMint: params.outputMint,
            amount: Number(params.amount),
            slippageBps,
          });
          route = `SOL → ${params.outputMint}`;
        } else if (params.inputMint && params.outputMint) {
          // SPL → SPL token
          response = await sdk.exchange.swapTokenToTokenSolana({
            inputMint: params.inputMint,
            outputMint: params.outputMint,
            amount: Number(params.amount),
          });
          route = `${params.inputMint} → ${params.outputMint}`;
        } else if (params.inputMint && !params.outputMint) {
          // SPL token → SOL
          response = await sdk.exchange.swapTokenToSol({
            amount: String(params.amount),
            inputMint: params.inputMint,
          });
          route = `${params.inputMint} → SOL`;
        } else {
          return {
            isError: true,
            content: [{
              type: "text" as const,
              text: "Invalid swap configuration: provide at least inputMint or outputMint (or both). Cannot swap SOL to SOL.",
            }],
          };
        }

        const output = {
          signature: response.data.signature,
          txUrl: response.data.txUrl,
          route,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        return toMcpError(error, "monei_swap_tokens_solana");
      }
    }
  );
}