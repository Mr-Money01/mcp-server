import { z } from "zod";
import { BillCategorySchema } from "./shared.schema.js";

// ─── Schedule Schema (optional for all bill payments) ────────────────────────

export const BillScheduleSchema = z
  .object({
    executionDate: z
      .string()
      .describe("ISO date string for when to execute the payment (e.g. '2025-04-01T00:00:00Z')"),
    isRecurring: z
      .boolean()
      .optional()
      .describe("Whether this should repeat automatically"),
    recurrencePattern: z
      .string()
      .optional()
      .describe("Recurrence pattern (e.g. 'MONTHLY', 'WEEKLY') — required if isRecurring is true"),
  })
  .describe("Optional schedule for deferred or recurring bill payments");

// ─── get_bill_providers ───────────────────────────────────────────────────────

export const GetBillProvidersSchema = z.object({
  category: BillCategorySchema,
  billerName: z
    .string()
    .optional()
    .describe(
      "Biller/network name to filter by. Required for AIRTIME, MOBILEDATA, CABLEBILLS (e.g. 'MTN', 'DSTV'). Not needed for UTILITYBILLS — all electricity providers are returned."
    ),
});

export type GetBillProvidersInput = z.infer<typeof GetBillProvidersSchema>;

// ─── pay_bill ─────────────────────────────────────────────────────────────────

const BillScheduleOptional = z
  .object({
    isSchedule: z.boolean().optional().describe("Set to true to schedule this payment for a later date"),
    scheduleData: BillScheduleSchema.optional(),
    saveBeneficiary: z.boolean().optional().describe("Save this recipient for future quick payments"),
    beneficiaryName: z.string().optional().describe("Label to save this beneficiary as"),
  });

export const PayAirtimeSchema = BillScheduleOptional.extend({
  category: z.literal("AIRTIME"),
  phoneNumber: z
    .string()
    .describe("Phone number to top up (e.g. '08012345678')"),
  biller: z
    .string()
    .describe("Biller/network code from monei_get_bill_providers (e.g. 'MTN', 'AIRTEL')"),
  amount: z
    .coerce.number()
    .positive()
    .describe("Airtime amount in NGN (e.g. 1000 for ₦1,000)"),
});

export const PayMobileDataSchema = BillScheduleOptional.extend({
  category: z.literal("MOBILEDATA"),
  phoneNumber: z
    .string()
    .describe("Phone number to buy data for (e.g. '08012345678')"),
  biller: z
    .string()
    .describe("Biller/network code from monei_get_bill_providers (e.g. 'MTN', 'AIRTEL')"),
  itemCode: z
    .string()
    .describe("Data bundle item code from monei_get_bill_providers (e.g. 'MD0001')"),
});

export const PayElectricitySchema = BillScheduleOptional.extend({
  category: z.literal("UTILITYBILLS"),
  meterNumber: z
    .string()
    .describe("Electricity meter number"),
  amount: z
    .coerce.number()
    .positive()
    .describe("Amount to pay in NGN (e.g. 5000 for ₦5,000)"),
  disco: z
    .string()
    .describe("Electricity provider code from monei_get_bill_providers (e.g. 'IKEDC', 'EKEDC')"),
});

export const PayCableTvSchema = BillScheduleOptional.extend({
  category: z.literal("CABLEBILLS"),
  smartcardNumber: z
    .string()
    .describe("Smartcard/IUC number on the decoder"),
  biller: z
    .string()
    .describe("Cable TV provider code from monei_get_bill_providers (e.g. 'DSTV', 'GOTV')"),
  itemCode: z
    .string()
    .describe("Subscription package item code from monei_get_bill_providers (e.g. 'DSTV0001')"),
});

// Discriminated union so the agent passes exactly the right fields per category
export const PayBillSchema = z.discriminatedUnion("category", [
  PayAirtimeSchema,
  PayMobileDataSchema,
  PayElectricitySchema,
  PayCableTvSchema,
]);

export type PayBillInput = z.infer<typeof PayBillSchema>;