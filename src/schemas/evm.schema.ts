import { z } from "zod";
import { ChainIdSchema, CryptoAmountSchema, EvmAddressSchema } from "./shared.schema.js";

export const SendCryptoEvmSchema = z.object({
  to: EvmAddressSchema.describe("Recipient EVM wallet address"),
  amount: CryptoAmountSchema.describe(
    "Amount to send as a string (e.g. '0.01' for 0.01 ETH, '100' for 100 USDT)"
  ),
  chainId: ChainIdSchema.describe(
    "Chain to send on. 56=BSC, 137=Polygon, 8453=Base, 1=Ethereum, 42161=Arbitrum, 10=Optimism"
  ),
  tokenAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid ERC-20 contract address")
    .optional()
    .describe(
      "ERC-20 token contract address. Omit this for native tokens (ETH, BNB, MATIC). Include it for ERC-20 tokens like USDT, USDC."
    ),
  transactionPin: z
    .string()
    .min(4)
    .max(6)
    .describe("User's 4-6 digit transaction PIN. Ask for this at runtime — never store or log it."),
});

export type SendCryptoEvmInput = z.infer<typeof SendCryptoEvmSchema>;