import { z } from "zod";

// Chain IDs for supported EVM networks
export const ChainIdSchema = z.union([
  z.literal(1).describe("Ethereum Mainnet"),
  z.literal(56).describe("BNB Smart Chain (BSC)"),
  z.literal(137).describe("Polygon"),
  z.literal(8453).describe("Base"),
  z.literal(42161).describe("Arbitrum One"),
  z.literal(10).describe("Optimism"),
  z.literal(534352).describe("Scroll"),
  z.literal(1135).describe("Lisk"),
]);

export type ChainId = z.infer<typeof ChainIdSchema>;

// Solana networks
export const SolanaNetworkSchema = z
  .enum(["mainnet-beta", "devnet", "testnet"])
  .default("mainnet-beta")
  .describe("Solana network to use. Defaults to mainnet-beta.");

export type SolanaNetwork = z.infer<typeof SolanaNetworkSchema>;

// Bill categories
export const BillCategorySchema = z
  .enum(["AIRTIME", "MOBILEDATA", "CABLEBILLS", "UTILITYBILLS"])
  .describe(
    "Category of bill to pay. AIRTIME for airtime top-up, MOBILEDATA for data bundles, CABLEBILLS for cable TV (DSTV, GOtv, Startimes), UTILITYBILLS for electricity."
  );

export type BillCategory = z.infer<typeof BillCategorySchema>;

// Transaction PIN — never logged, never stored
export const TransactionPinSchema = z
  .string()
  .min(4)
  .max(6)
  .describe(
    "User transaction PIN (4-6 digits). Required for all money movement operations. Prompt the user for this if not provided — never store or log it."
  );

// Pagination
export const PaginationSchema = z.object({
  page: z.number().int().min(1).default(1).optional().describe("Page number, starting from 1"),
  limit: z.number().int().min(1).max(100).default(20).optional().describe("Number of results per page, max 100"),
});

export type Pagination = z.infer<typeof PaginationSchema>;

// EVM wallet address
export const EvmAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid EVM wallet address (0x followed by 40 hex characters)")
  .describe("EVM wallet address (e.g. 0x742d35Cc6634C0532925a3b844Bc454e4438f44e)");

// Solana wallet address
export const SolanaAddressSchema = z
  .string()
  .min(32)
  .max(44)
  .describe("Solana wallet address (base58 encoded, e.g. 5AH3qo1v1EZfT3QKQpSsx1F8W5JyGEVZPcD5DzkX1N1d)");

// Nigerian bank account number
export const AccountNumberSchema = z
  .string()
  .length(10, "Nigerian bank account numbers are exactly 10 digits")
  .regex(/^\d{10}$/, "Account number must be exactly 10 digits")
  .describe("Nigerian bank account number (exactly 10 digits)");

// Bank code (e.g. GTBank = 058)
export const BankCodeSchema = z
  .string()
  .describe("Bank code (e.g. '058' for GTBank, '033' for UBA). Call get_banks to get the full list of bank codes.");

// Crypto amount as string (avoids floating point issues)
export const CryptoAmountSchema = z
  .string()
  .regex(/^\d+(\.\d+)?$/, "Amount must be a positive number string (e.g. '0.01' or '100')")
  .describe("Token amount as a string to avoid floating point issues (e.g. '0.01', '100', '1.5')");

// NGN amount as number — coerced so agents passing "100" instead of 100 still work
export const NgnAmountSchema = z
  .coerce.number()
  .positive("Amount must be greater than 0")
  .describe("Amount in Nigerian Naira (NGN). Must be a positive number.");

// Reference string
export const ReferenceSchema = z
  .string()
  .min(1)
  .describe("Transaction reference string returned from a previous operation");