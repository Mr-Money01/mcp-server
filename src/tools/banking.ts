import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createClient } from "../client.js";
import { safeExecute } from "../errors.js";
import { AccountNumberSchema, BankCodeSchema } from "../schemas/shared.schema.js";
import { VerifyBankAccountRequestDto } from "monei-sdk";

export function registerBankingTools(server: McpServer, apiKey?: string): void {

  server.registerTool(
    "monei_get_banks",
    {
      title: "Get Banks",
      description: `Returns the full list of Nigerian banks supported by Monei, including their bank codes.

Call this before any payout to a bank account if you do not already have the bank code. The bank code is required for both send_naira_to_bank and verify_bank_account.

Returns:
{
  "banks": [
    {
      "name": string,    // Human-readable bank name (e.g. "Guaranty Trust Bank")
      "code": string,    // Bank code to use in other tools (e.g. "058")
    }
  ]
}

Examples:
  - "What banks do you support?" -> call this, show bank names
  - "What's the code for GTBank?" -> call this, find GTBank in list, return its code
  - User mentions a bank by name but you don't have its code -> call this first`,
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      return safeExecute(async () => {
        const sdk = createClient(apiKey);
        const response = await sdk.walletUtility.getBanks();
        const output = {
          banks: response.data.map((b: { name: any; code: any; }) => ({ name: b.name, code: b.code })),
        };
        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      }, "monei_get_banks");
    }
  );

  server.registerTool(
    "monei_verify_bank_account",
    {
      title: "Verify Bank Account",
      description: `Verifies a Nigerian bank account number and returns the account holder's name.

Always call this before sending naira to a bank account. Surfacing the account name to the user before they confirm the transaction prevents sending to the wrong account.

Args:
  - accountNumber (string): 10-digit Nigerian bank account number
  - bankCode (string): Bank code from monei_get_banks (e.g. "058" for GTBank)

Returns:
{
  "accountName": string,
  "accountNumber": string,
  "bankCode": string
}

Examples:
  - Before sending to 0123456789 at GTBank -> call this with accountNumber="0123456789", bankCode="058"
  - User says "send to my GTBank account 0123456789" -> verify first, show account name, confirm before sending

Error handling:
  - Returns error if the account number does not exist at the given bank
  - Returns error if the bank code is invalid (call monei_get_banks to find valid codes)`,
      inputSchema: z.object({
        accountNumber: AccountNumberSchema,
        bankCode: BankCodeSchema,
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ accountNumber, bankCode }) => {
      return safeExecute(async () => {
        const sdk = createClient(apiKey);
        const response = await sdk.walletUtility.verifyBankAccount({
          accountNumber: String(accountNumber),
          bank: bankCode,
        } as VerifyBankAccountRequestDto);
        const data = response.data;
        const output = {
          accountName: data.accountName,
          accountNumber: data.accountNumber,
          bankCode: data.bankCode,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      }, "monei_verify_bank_account");
    }
  );
}