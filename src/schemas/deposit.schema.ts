import { z } from "zod";
import { NgnAmountSchema } from "./shared.schema.js";

export const GenerateDepositLinkSchema = z.object({
  amount: NgnAmountSchema.describe(
    "Amount in NGN to deposit (e.g. 50000 for ₦50,000)"
  ),
  customerEmail: z
    .string()
    .email()
    .optional()
    .describe("Customer email address to pre-fill on the payment page (optional)"),
  customerName: z
    .string()
    .optional()
    .describe("Customer name to pre-fill on the payment page (optional)"),
  customerPhone: z
    .string()
    .optional()
    .describe("Customer phone number to pre-fill on the payment page (optional)"),
});

export type GenerateDepositLinkInput = z.infer<typeof GenerateDepositLinkSchema>;