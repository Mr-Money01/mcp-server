import { z } from "zod";
import { SolanaNetworkSchema, CryptoAmountSchema, SolanaAddressSchema } from "./shared.schema.js";

export const SendCryptoSolanaSchema = z.object({
  to: SolanaAddressSchema.describe("Recipient Solana wallet address (base58 encoded)"),
  amount: CryptoAmountSchema.describe(
    "Amount to send as a string (e.g. '2' for 2 SOL, '50' for 50 USDC)"
  ),
  network: SolanaNetworkSchema.optional(),
  tokenMintAddress: z
    .string()
    .min(32)
    .max(44)
    .optional()
    .describe(
      "SPL token mint address. Omit for native SOL transfers. Include for SPL tokens like USDC, USDT on Solana."
    ),
  transactionPin: z
    .string()
    .min(4)
    .max(6)
    .describe("User's 4-6 digit transaction PIN. Ask for this at runtime — never store or log it."),
});

export type SendCryptoSolanaInput = z.infer<typeof SendCryptoSolanaSchema>;