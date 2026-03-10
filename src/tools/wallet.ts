import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createClient } from "../client.js";
import { toMcpError } from "../errors.js";
import { ChainIdSchema } from "../schemas/shared.schema.js";
import { SolanaNetworkSchema } from "../schemas/shared.schema.js";
import { SolanaNetwork } from "monei-sdk";

export function registerWalletTools(server: McpServer, apiKey?: string): void {

  // ─── get_wallet ───────────────────────────────────────────────────────────
  server.registerTool(
    "monei_get_wallet",
    {
      title: "Get Wallet",
      description: `Returns the user's full wallet overview including NGN balance and all subwallets (EVM and Solana).

Call this at the start of any transaction flow to confirm the user has sufficient balance before attempting sends, swaps, or offramp. This is the single source of truth for all balances.

Args:
  - chainId (number, optional): If provided, filters the EVM portfolio to a specific chain.

Returns:
{
  "nairaBalance": number,          // NGN balance
  "subwallets": [
    {
      "id": string,
      "type": "FIAT" | "CRYPTO",
      "currency": string,
      "balance": number,
      "chain": "EVM" | "SOLANA" | null,
      "publicAddress": string | null
    }
  ]
}

Examples:
  - "What's my balance?" -> call this, show nairaBalance and subwallet balances
  - "Do I have enough USDT to send 100?" -> check the relevant subwallet balance
  - "What's my EVM wallet address?" -> find the subwallet with chain='EVM' and show publicAddress`,
      inputSchema: z.object({
        chainId: ChainIdSchema.optional().describe(
          "Optional EVM chain ID to scope the portfolio. If not provided, returns all subwallets."
        ),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ chainId }) => {
      try {
        const sdk = createClient(apiKey);
        const response = await sdk.walletAccount.me(chainId as number);
        const data = response.data;

        const output = {
          nairaBalance: data.nairaBalance,
          subwallets: (data.subwallets ?? []).map((sw) => ({
            id: sw.id,
            type: sw.type,
            currency: sw.currency,
            balance: sw.balance,
            chain: sw.chain ?? null,
            publicAddress: sw.publicAddress ?? null,
          })),
        };

        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        return toMcpError(error, "monei_get_wallet");
      }
    }
  );

  // ─── get_evm_portfolio ────────────────────────────────────────────────────
  server.registerTool(
    "monei_get_evm_portfolio",
    {
      title: "Get EVM Portfolio",
      description: `Returns the full token portfolio for the user's EVM wallet on a specific chain, including native token and all ERC-20 holdings with USD values.

Use this when the user wants a detailed breakdown of their crypto holdings on a specific EVM network (BSC, Polygon, Base, etc.). For a simple balance check, use monei_get_wallet instead.

Args:
  - chainId (number): The EVM chain to query. Common values: 56 (BSC), 137 (Polygon), 8453 (Base), 1 (Ethereum), 42161 (Arbitrum), 10 (Optimism).

Returns:
{
  "walletAddress": string,
  "network": string,
  "totalPortfolioValueUSD": string,
  "nativeToken": {
    "name": string, "symbol": string, "balance": string, "balanceUSD": string, "priceUSD": string
  },
  "tokens": [
    { "name": string, "symbol": string, "contractAddress": string, "balance": string, "balanceUSD": string }
  ],
  "updatedAt": string
}

Examples:
  - "What tokens do I have on BSC?" -> chainId: 56
  - "Show my Polygon holdings" -> chainId: 137
  - "What's my USDC balance on Base?" -> chainId: 8453, then check tokens array for USDC`,
      inputSchema: z.object({
        chainId: ChainIdSchema.describe(
          "EVM chain to query. 56=BSC, 137=Polygon, 8453=Base, 1=Ethereum, 42161=Arbitrum, 10=Optimism, 534352=Scroll, 1135=Lisk"
        ),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ chainId }) => {
      try {
        const sdk = createClient(apiKey);
        const response = await sdk.evm.getPortfolio(chainId as number);
        const data = response.data;

        const output = {
          walletAddress: data.walletAddress,
          network: data.network,
          totalPortfolioValueUSD: data.totalPortfolioValueUSD,
          nativeToken: {
            name: data.nativeToken.name,
            symbol: data.nativeToken.symbol,
            balance: data.nativeToken.balance,
            balanceUSD: data.nativeToken.balanceUSD,
            priceUSD: data.nativeToken.priceUSD,
          },
          tokens: data.tokens.map((t) => ({
            name: t.name,
            symbol: t.symbol,
            contractAddress: t.contractAddress,
            balance: t.balance,
            balanceUSD: t.balanceUSD,
            priceUSD: t.priceUSD,
          })),
          updatedAt: data.updatedAt,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        return toMcpError(error, "monei_get_evm_portfolio");
      }
    }
  );

  // ─── get_solana_portfolio ─────────────────────────────────────────────────
  server.registerTool(
    "monei_get_solana_portfolio",
    {
      title: "Get Solana Portfolio",
      description: `Returns the full token portfolio for the user's Solana wallet, including SOL balance and all SPL token holdings with USD values.

Use this when the user wants a breakdown of what they hold on Solana. For a simple balance check, use monei_get_wallet instead.

Args:
  - network (string, optional): 'mainnet-beta' (default), 'devnet', or 'testnet'.

Returns:
{
  "address": string,             // Solana wallet address
  "nativeBalance": string,       // SOL balance
  "nativeBalanceUsd": number,
  "tokens": [
    {
      "mintAddress": string, "name": string, "symbol": string,
      "balance": string, "valueUsd": number, "priceUsd": number
    }
  ],
  "totalValueUsd": number
}

Examples:
  - "What's in my Solana wallet?" -> call with default network
  - "Do I have any USDC on Solana?" -> check tokens array for USDC symbol
  - "What's my SOL balance?" -> check nativeBalance field`,
      inputSchema: z.object({
        network: SolanaNetworkSchema.optional(),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ network }) => {
      try {
        const sdk = createClient(apiKey);
        const response = await sdk.solana.getPortfolio(network as SolanaNetwork);
        const data = response.data;

        const output = {
          address: data.address,
          nativeBalance: data.nativeBalance,
          nativeBalanceLamports: data.nativeBalanceLamports,
          nativeBalanceUsd: data.nativeBalanceUsd,
          tokens: data.tokens.map((t) => ({
            mintAddress: t.mintAddress,
            name: t.name,
            symbol: t.symbol,
            balance: t.balance,
            valueUsd: t.valueUsd,
            priceUsd: t.priceUsd,
          })),
          totalValueUsd: data.totalValueUsd,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        return toMcpError(error, "monei_get_solana_portfolio");
      }
    }
  );

  // ─── get_my_solana_address ────────────────────────────────────────────────
  server.registerTool(
    "monei_get_my_solana_address",
    {
      title: "Get My Solana Address",
      description: `Returns the user's Solana wallet address so they can share it to receive SOL or SPL tokens.

Use this specifically when the user says "What's my Solana address?" or "I want to receive SOL/USDC on Solana" or "Share my Solana wallet". For full portfolio details, use monei_get_solana_portfolio instead.

Returns:
{
  "address": string    // Solana wallet address (base58 encoded)
}

Examples:
  - "What's my Solana address?" -> call this, show address
  - "I want to receive USDC on Solana" -> call this, present the address to share`,
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const sdk = createClient(apiKey);
        const response = await sdk.solana.getWalletAddress();
        const output = { address: response.data.address };

        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        return toMcpError(error, "monei_get_my_solana_address");
      }
    }
  );

  // ─── get_supported_networks ───────────────────────────────────────────────
  server.registerTool(
    "monei_get_supported_networks",
    {
      title: "Get Supported Networks",
      description: `Returns all EVM blockchain networks supported by Monei, including chain IDs, native tokens, and block explorer URLs.

Use this when:
- The user asks what chains or networks are supported
- The user mentions a chain name and you need the chain ID to pass to another tool
- You need to help the user pick a network before a swap or crypto send

Returns:
{
  "networks": [
    {
      "chainId": number,
      "name": string,            // e.g. "BNB Smart Chain"
      "nativeToken": string,     // e.g. "BNB"
      "blockExploreUrl": string,
      "isTestnet": boolean
    }
  ]
}

Examples:
  - "What networks do you support?" -> call this
  - "What's the chain ID for Polygon?" -> call this, find Polygon in the list`,
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const sdk = createClient(apiKey);
        const response = await sdk.evm.getSupportedNetworks();
        const networks = response.data;

        const output = {
          networks: networks.map((n) => ({
            chainId: n.chainId,
            name: n.name,
            nativeToken: n.nativeToken,
            blockExploreUrl: n.blockExploreUrl,
            isTestnet: n.isTestnet,
          })),
        };

        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        return toMcpError(error, "monei_get_supported_networks");
      }
    }
  );
}