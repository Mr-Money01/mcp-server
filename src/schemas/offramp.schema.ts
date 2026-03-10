import { z } from "zod";
import {
  AccountNumberSchema,
  BankCodeSchema,
  ReferenceSchema,
} from "./shared.schema.js";

// Offramp networks — matches OfframpNetworks enum in the SDK
export const OfframpNetworkSchema = z
  .enum([
    "base",
    "polygon",
    "arbitrum-one",
    "bnb-smart-chain",
    "ethereum",
    "starknet",
    "optimism",
    "lisk",
    "scroll",
  ])
  .describe(
    "Blockchain network the token is on. Supported: base, polygon, arbitrum-one, bnb-smart-chain, ethereum, starknet, optimism, lisk, scroll"
  );

export type OfframpNetwork = z.infer<typeof OfframpNetworkSchema>;

// Tokens supported for offramp — matches OfframpAssets enum in the SDK
export const OfframpTokenSchema = z
  .enum(["USDT", "USDC", "CNGN"])
  .describe("Token to sell. Supported: USDT, USDC, CNGN");

export type OfframpToken = z.infer<typeof OfframpTokenSchema>;

// get_offramp_quote
export const GetOfframpQuoteSchema = z.object({
  token: OfframpTokenSchema,
  network: OfframpNetworkSchema,
  amount: z
    .coerce.number()
    .positive("Amount must be greater than 0")
    .describe("Amount of the token to sell as a number (e.g. 100 for 100 USDT)"),
  fiat: z
    .enum(["NGN"])
    .default("NGN")
    .optional()
    .describe("Fiat currency to receive. Currently only NGN is supported."),
});

export type GetOfframpQuoteInput = z.infer<typeof GetOfframpQuoteSchema>;

// sell_crypto_for_naira — maps to SwapCryptoToFiatRequestDto in the SDK
export const SellCryptoForNairaSchema = z.object({
  amount: z
    .coerce.number()
    .positive("Amount must be greater than 0")
    .describe("Amount of token to sell as a number (e.g. 100 for 100 USDT)"),
  token: OfframpTokenSchema,
  network: OfframpNetworkSchema,
  fiatCurrency: z
    .enum(["NGN"])
    .default("NGN")
    .describe("Fiat currency to receive. Currently only NGN is supported."),
  bankCode: BankCodeSchema.describe(
    "Destination bank code. Call monei_get_banks if you don't have this."
  ),
  accountNumber: AccountNumberSchema.describe("Destination bank account number (10 digits)"),
  accountName: z
    .string()
    .min(1)
    .describe(
      "Account holder name as returned by monei_verify_bank_account. Always verify and show this to the user for confirmation before calling."
    ),
});

export type SellCryptoForNairaInput = z.infer<typeof SellCryptoForNairaSchema>;

// track_offramp
export const TrackOfframpSchema = z.object({
  reference: ReferenceSchema.describe(
    "Offramp transaction reference returned from monei_sell_crypto_for_naira"
  ),
});

export type TrackOfframpInput = z.infer<typeof TrackOfframpSchema>;