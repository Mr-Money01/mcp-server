import { z } from "zod";
import {
  NgnAmountSchema,
  AccountNumberSchema,
  BankCodeSchema,
  TransactionPinSchema,
} from "./shared.schema.js";

export const SendNairaToBankSchema = z.object({
  amount: NgnAmountSchema.describe("Amount in NGN to send (e.g. 20000 for ₦20,000)"),
  bankCode: BankCodeSchema,
  accountNumber: AccountNumberSchema,
  transactionPin: TransactionPinSchema,
  narration: z
    .string()
    .max(100)
    .optional()
    .describe("Optional description or note for the transfer (max 100 characters)"),
});

export type SendNairaToBankInput = z.infer<typeof SendNairaToBankSchema>;

export const SendNairaToUserSchema = z.object({
  amount: NgnAmountSchema.describe("Amount in NGN to send (e.g. 5000 for ₦5,000)"),
  receiver: z
    .string()
    .min(1)
    .describe(
      "The recipient's registered Monei email address or phone number (e.g. john@gmail.com or 08012345678)"
    ),
  transactionPin: TransactionPinSchema,
});

export type SendNairaToUserInput = z.infer<typeof SendNairaToUserSchema>;