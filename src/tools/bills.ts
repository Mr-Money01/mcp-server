
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createClient } from "../client.js";
import { toMcpError } from "../errors.js";
import { GetBillProvidersSchema, PayBillSchema } from "../schemas/bills.schema.js";

export function registerBillsTools(server: McpServer, apiKey?: string): void {

  // ─── monei_get_bill_providers ─────────────────────────────────────────────
  server.registerTool(
    "monei_get_bill_providers",
    {
      title: "Get Bill Providers",
      description: `Returns available billers and packages for a given bill category.

Always call this before monei_pay_bill to get the correct biller codes and item codes needed for payment.

Routing:
  - UTILITYBILLS → returns all electricity providers (no billerName needed)
  - AIRTIME, MOBILEDATA, CABLEBILLS → requires billerName to filter (e.g. "MTN", "DSTV")

Args:
  - category (string): "AIRTIME" | "MOBILEDATA" | "CABLEBILLS" | "UTILITYBILLS"
  - billerName (string, optional): Network or provider to filter by. Required for non-electricity categories.

Returns for AIRTIME/MOBILEDATA/CABLEBILLS:
{
  "providers": [
    {
      "billerCode": string,    // Use as 'biller' or 'disco' in monei_pay_bill
      "itemCode": string,      // Use as 'itemCode' in monei_pay_bill (data/cable only)
      "name": string,          // Human-readable package name
      "amount": number,        // Fixed price (0 means user-specified amount)
      "validityPeriod": string | null
    }
  ]
}

Returns for UTILITYBILLS:
{
  "providers": [
    {
      "name": string,           // e.g. "Ikeja Electric"
      "code": string,           // Use as 'disco' in monei_pay_bill
      "billerCode": string
    }
  ]
}

Examples:
  - "What MTN data plans are available?" -> category: "MOBILEDATA", billerName: "MTN"
  - "What electricity providers do you support?" -> category: "UTILITYBILLS"
  - "Show me DSTV packages" -> category: "CABLEBILLS", billerName: "DSTV"
  - "Buy MTN airtime" -> category: "AIRTIME", billerName: "MTN" to get the biller code first`,
      inputSchema: GetBillProvidersSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const sdk = createClient(apiKey);

        if (params.category === "UTILITYBILLS") {
          const response = await sdk.billsDiscovery.getElectricityBiller();
          const output = {
            providers: response.data.map((p) => ({
              name: p.name,
              code: p.code,
              billerCode: p.billerCode,
            })),
          };
          return {
            content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
            structuredContent: output,
          };
        } else {
          if (!params.billerName) {
            return {
              isError: true,
              content: [{
                type: "text" as const,
                text: `billerName is required for category '${params.category}'. For example: "MTN", "AIRTEL", "DSTV", "GOTV".`,
              }],
            };
          }
          const response = await sdk.billsDiscovery.getBiller(params.category, params.billerName);
          const output = {
            providers: response.data.map((p) => ({
              billerCode: p.biller_code,
              itemCode: p.item_code,
              name: p.name,
              shortName: p.short_name,
              amount: p.amount,
              validityPeriod: p.validity_period ?? null,
              labelName: p.label_name,
            })),
          };
          return {
            content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
            structuredContent: output,
          };
        }
      } catch (error) {
        return toMcpError(error, "monei_get_bill_providers");
      }
    }
  );

  // ─── monei_pay_bill ───────────────────────────────────────────────────────
  server.registerTool(
    "monei_pay_bill",
    {
      title: "Pay Bill",
      description: `Pays a utility bill, buys airtime, purchases a data bundle, or subscribes to cable TV.

Routes to the correct payment method based on the 'category' field:
  - AIRTIME       → airtime top-up for a phone number
  - MOBILEDATA    → data bundle purchase for a phone number
  - UTILITYBILLS  → electricity payment by meter number
  - CABLEBILLS    → cable TV subscription by smartcard number

Before calling:
1. Call monei_get_bill_providers to get valid biller codes and item codes
2. Confirm the user has sufficient NGN balance using monei_get_wallet
3. For data and cable, call monei_validate_bill first to confirm the customer details

Args depend on category:

AIRTIME:
  - phoneNumber (string): Phone to top up
  - biller (string): Biller code from monei_get_bill_providers
  - amount (number): Amount in NGN

MOBILEDATA:
  - phoneNumber (string): Phone to buy data for
  - biller (string): Biller code from monei_get_bill_providers
  - itemCode (string): Data bundle code from monei_get_bill_providers

UTILITYBILLS:
  - meterNumber (string): Electricity meter number
  - disco (string): Provider code from monei_get_bill_providers
  - amount (number): Amount to pay in NGN

CABLEBILLS:
  - smartcardNumber (string): Decoder smartcard/IUC number
  - biller (string): Provider code from monei_get_bill_providers
  - itemCode (string): Package code from monei_get_bill_providers

All categories also accept optional:
  - isSchedule (boolean): Set true to schedule for a later date
  - scheduleData: { executionDate, isRecurring?, recurrencePattern? }
  - saveBeneficiary (boolean): Save recipient for future use
  - beneficiaryName (string): Label for the saved beneficiary

Returns:
{
  "id": string,
  "reference": string,
  "billerName": string,
  "customer": string,
  "amount": number,
  "status": string,       // "PENDING" | "SUCCESS" | "FAILED"
  "token": string | null, // Electricity token (for prepaid meters)
  "units": string | null  // Electricity units (for prepaid meters)
}

Examples:
  - "Buy ₦1,000 MTN airtime for 08012345678" -> category: "AIRTIME"
  - "Get me 1GB MTN data for 08012345678" -> category: "MOBILEDATA"
  - "Pay ₦5,000 to my IKEDC meter 12345678901" -> category: "UTILITYBILLS"
  - "Subscribe DSTV Compact for smartcard 1234567890" -> category: "CABLEBILLS"
  - "Pay my DSTV every month on the 1st" -> include isSchedule: true, scheduleData with recurrence`,
      inputSchema: PayBillSchema,
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

        const scheduleFields = {
          ...(params.isSchedule !== undefined ? { isSchedule: params.isSchedule } : {}),
          ...(params.scheduleData ? { scheduleData: params.scheduleData } : {}),
          ...(params.saveBeneficiary !== undefined ? { saveBeneficiary: params.saveBeneficiary } : {}),
          ...(params.beneficiaryName ? { beneficiaryName: params.beneficiaryName } : {}),
        };

        switch (params.category) {
          case "AIRTIME":
            response = await sdk.billsPay.buyAirtime({
              phoneNumber: params.phoneNumber,
              biller: params.biller,
              amount: params.amount as number,
              ...scheduleFields,
            });
            break;

          case "MOBILEDATA":
            response = await sdk.billsPay.buyMobileData({
              phoneNumber: params.phoneNumber,
              biller: params.biller,
              itemCode: params.itemCode,
              ...scheduleFields,
            });
            break;

          case "UTILITYBILLS":
            response = await sdk.billsPay.buyElectricity({
              meterNumber: params.meterNumber,
              disco: params.disco,
              amount: params.amount,
              ...scheduleFields,
            });
            break;

          case "CABLEBILLS":
            response = await sdk.billsPay.subscribeCableTv({
              smartcardNumber: params.smartcardNumber,
              biller: params.biller,
              itemCode: params.itemCode,
              ...scheduleFields,
            });
            break;
        }

        const data = response.data;
        const output = {
          id: data.id,
          reference: data.reference,
          billerName: data.billerName,
          customer: data.customer,
          amount: data.amount,
          status: data.status,
          token: data.token ?? null,
          units: data.units ?? null,
          validityPeriod: data.validityPeriod ?? null,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        return toMcpError(error, "monei_pay_bill");
      }
    }
  );

  // ─── monei_get_bill_history ───────────────────────────────────────────────
  server.registerTool(
    "monei_get_bill_history",
    {
      title: "Get Bill History",
      description: `Returns the user's recent bill payment history across all categories: airtime, data, electricity, and cable TV.

Use this when the user wants to review past bill payments, check if a payment went through, or audit utility spending.

Returns:
{
  "bills": [
    {
      "id": string,
      "reference": string,
      "type": string,          // "AIRTIME" | "MOBILEDATA" | "UTILITYBILLS" | "CABLEBILLS"
      "billerName": string,
      "customer": string,      // Phone, meter number, or smartcard depending on type
      "amount": number,
      "status": string,        // "PENDING" | "SUCCESS" | "FAILED"
      "token": string | null,  // Electricity token for prepaid meters
      "units": string | null,
      "createdAt": string
    }
  ],
  "total": number,
  "page": number,
  "totalPages": number
}

Examples:
  - "Show my recent bill payments" -> call this
  - "Did my electricity payment go through?" -> call this, filter by type=UTILITYBILLS
  - "When did I last buy MTN airtime?" -> call this, filter by type=AIRTIME`,
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
        const response = await sdk.billsRecords.getBills();
        const data = response.data;

        const output = {
          bills: (data.bills ?? []).map((b) => ({
            id: b.id,
            reference: b.reference,
            type: b.type,
            billerName: b.billerName,
            customer: b.customer,
            amount: b.amount,
            status: b.status,
            token: b.token ?? null,
            units: b.units ?? null,
            validityPeriod: b.validityPeriod ?? null,
            createdAt: b.createdAt,
          })),
          total: data.total,
          page: data.page,
          totalPages: data.totalPages,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        return toMcpError(error, "monei_get_bill_history");
      }
    }
  );
}