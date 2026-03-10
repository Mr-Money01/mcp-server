import { z } from "zod";
import { ChainIdSchema, CryptoAmountSchema } from "./shared.schema.js";

// ─── EVM Swap Schemas ─────────────────────────────────────────────────────────

// Native → ERC-20  (e.g. ETH → USDC)
export const SwapNativeToTokenEvmSchema = z.object({
  amount: CryptoAmountSchema.describe("Amount of native token to swap (e.g. '0.1' for 0.1 ETH)"),
  tokenOut: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid ERC-20 contract address")
    .describe("Contract address of the token to receive"),
  chainId: ChainIdSchema.describe(
    "Chain to swap on. 56=BSC, 137=Polygon, 8453=Base, 1=Ethereum, 42161=Arbitrum, 10=Optimism"
  ),
});

// ERC-20 → ERC-20  (e.g. USDC → USDT)
export const SwapTokenToTokenEvmSchema = z.object({
  tokenIn: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid ERC-20 contract address")
    .describe("Contract address of the token to sell"),
  tokenOut: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid ERC-20 contract address")
    .describe("Contract address of the token to receive"),
  amount: CryptoAmountSchema.describe("Amount of tokenIn to swap (e.g. '100' for 100 USDC)"),
  chainId: ChainIdSchema.optional().describe(
    "Chain to swap on. 56=BSC, 137=Polygon, 8453=Base, 1=Ethereum"
  ),
});

// ERC-20 → Native  (e.g. USDC → ETH)
export const SwapTokenToNativeEvmSchema = z.object({
  amount: CryptoAmountSchema.describe("Amount of token to swap (e.g. '100' for 100 USDC)"),
  tokenIn: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid ERC-20 contract address")
    .describe("Contract address of the token to sell"),
  chainId: ChainIdSchema.describe(
    "Chain to swap on. 56=BSC, 137=Polygon, 8453=Base, 1=Ethereum, 42161=Arbitrum, 10=Optimism"
  ),
});

// Combined EVM swap schema — agent passes tokenIn/tokenOut optionally, routing handled in tool
export const SwapTokensEvmSchema = z.object({
  amount: CryptoAmountSchema.describe(
    "Amount to swap as a string. For native-to-token swaps this is the native amount (e.g. '0.1' ETH). For token swaps this is the tokenIn amount."
  ),
  chainId: ChainIdSchema.describe(
    "Chain to swap on. 56=BSC, 137=Polygon, 8453=Base, 1=Ethereum, 42161=Arbitrum, 10=Optimism"
  ),
  tokenIn: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid ERC-20 contract address")
    .optional()
    .describe(
      "Contract address of the token to sell. Omit if selling the native token (ETH, BNB, MATIC)."
    ),
  tokenOut: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid ERC-20 contract address")
    .optional()
    .describe(
      "Contract address of the token to buy. Omit if buying the native token (ETH, BNB, MATIC)."
    ),
  slippageBps: z
    .number()
    .int()
    .min(0)
    .max(10000)
    .default(50)
    .optional()
    .describe("Slippage tolerance in basis points. Default is 50 (0.5%). Max is 10000 (100%)."),
});

export type SwapTokensEvmInput = z.infer<typeof SwapTokensEvmSchema>;

// ─── Solana Swap Schema ───────────────────────────────────────────────────────

export const SwapTokensSolanaSchema = z.object({
  amount: z
    .union([z.string(), z.number()])
    .describe(
      "Amount to swap. For SOL-to-token use a number (e.g. 1 for 1 SOL). For token-to-SOL use a string (e.g. '100' for 100 USDC). For token-to-token use a number."
    ),
  inputMint: z
    .string()
    .min(32)
    .max(44)
    .optional()
    .describe(
      "Mint address of the token to sell. Omit if selling native SOL."
    ),
  outputMint: z
    .string()
    .min(32)
    .max(44)
    .optional()
    .describe(
      "Mint address of the token to buy. Omit if buying native SOL."
    ),
  slippageBps: z
    .number()
    .int()
    .min(0)
    .max(10000)
    .default(50)
    .optional()
    .describe("Slippage tolerance in basis points. Default is 50 (0.5%)."),
});

export type SwapTokensSolanaInput = z.infer<typeof SwapTokensSolanaSchema>;