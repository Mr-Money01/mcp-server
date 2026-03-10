import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createClient } from "../client.js";
import { toMcpError } from "../errors.js";
import { GenerateDepositLinkSchema } from "../schemas/deposit.schema.js";
import { ReferenceSchema } from "../schemas/shared.schema.js";
import { GeneratePaymentLinkDto } from "monei-sdk/dist/types/deposit.js";

export function registerDepositTools(server: McpServer, apiKey?: string): void {

  // ─── generate_deposit_link ────────────────────────────────────────────────
  server.registerTool(
    "monei_generate_deposit_link",
    {
      title: "Generate Deposit Link",
      description: `Generates a payment link the user can open to deposit NGN into their Monei wallet.

This is the simplest deposit path and works in one call. The user opens the returned link, completes payment via their bank, and the funds arrive in their NGN wallet. Card and USSD multi-step flows are not supported through this tool.

Args:
  - amount (number): Amount in NGN to deposit (e.g. 50000 for ₦50,000)
  - customerEmail (string, optional): Pre-fills the email field on the payment page
  - customerName (string, optional): Pre-fills the name field on the payment page
  - customerPhone (string, optional): Pre-fills the phone field on the payment page

Returns:
{
  "paymentLink": string,     // URL the user opens to complete the deposit
}

After returning the link, tell the user to open it to complete payment. Then they can ask you to check the status using the reference.

Examples:
  - "I want to deposit ₦50,000" -> amount: 50000
  - "Add ₦10k to my wallet" -> amount: 10000`,
      inputSchema: GenerateDepositLinkSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const sdk = createClient(apiKey);

        const customer =
          params.customerEmail || params.customerName || params.customerPhone
            ? {
                email: params.customerEmail,
                name: params.customerName,
                phone: params.customerPhone,
              }
            : undefined;

        const response = await sdk.deposit.generatePaymentLink({
          amount: params.amount,
          ...(customer ? { customer } : {}),
        } as GeneratePaymentLinkDto);

        const data = response.data;
        const output = {
          paymentLink: data.link,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        return toMcpError(error, "monei_generate_deposit_link");
      }
    }
  );

  // ─── check_deposit_status ─────────────────────────────────────────────────
  server.registerTool(
    "monei_check_deposit_status",
    {
      title: "Check Deposit Status",
      description: `Checks the status of a deposit by its reference string.

Use this after generating a deposit link to confirm whether the user has completed payment. Poll this every 30-60 seconds if the user is waiting.

Args:
  - reference (string): The reference returned from monei_generate_deposit_link

Returns:
{
  "reference": string,
  "status": string,       // "PENDING" | "COMPLETED" | "FAILED" | "CANCELLED"
  "amount": number,
  "currency": string,
  "paidAt": string | null
}

Examples:
  - "Did my deposit go through?" -> call this with the reference from the deposit link
  - "Check if the ₦50k arrived" -> call this with the deposit reference`,
      inputSchema: z.object({
        reference: ReferenceSchema,
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ reference }) => {
      try {
        const sdk = createClient(apiKey);
        const response = await sdk.deposit.getStatus(reference);
        const data = response.data;

        const output = {
          reference: data.reference,
          status: data.status,
          amount: data.amount,
          currency: data.currency,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        return toMcpError(error, "monei_check_deposit_status");
      }
    }
  );
}