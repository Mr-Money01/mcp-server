import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createClient } from "../client.js";
import { toMcpError } from "../errors.js";
import { SendNairaToBankSchema, SendNairaToUserSchema } from "../schemas/payout.schema.js";

export function registerPayoutTools(server: McpServer, apiKey?: string): void {

  // ─── send_naira_to_bank ───────────────────────────────────────────────────
  server.registerTool(
    "monei_send_naira_to_bank",
    {
      title: "Send Naira to Bank",
      description: `Sends NGN from the user's Monei wallet to any Nigerian bank account.

Before calling this tool:
1. Confirm the user has sufficient NGN balance using monei_get_wallet
2. Call monei_verify_bank_account to get the account holder's name and show it to the user for confirmation
3. Ask for the user's transaction PIN if not already provided — never store or log it

Args:
  - amount (number): Amount in NGN to send (e.g. 20000 for ₦20,000)
  - bankCode (string): Bank code from monei_get_banks (e.g. "058" for GTBank)
  - accountNumber (string): 10-digit recipient bank account number
  - transactionPin (string): User's 4-6 digit transaction PIN — ask for this at runtime
  - narration (string, optional): Note for the transfer (max 100 characters)

Returns:
{
  "reference": string,
  "status": string,       // "PENDING" | "COMPLETED" | "FAILED"
  "amount": number,
}

Examples:
  - "Send ₦20,000 to my GTBank account 0123456789" -> verify account first, then call with bankCode="058"
  - "Pay 5000 naira to account 0987654321 at UBA" -> verify, confirm name, then send

Security: Never log or store the transactionPin. Pass it directly to this call only.`,
      inputSchema: SendNairaToBankSchema,
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

        const response = await sdk.payout.bankTransfer({
          amount: params.amount,
          bank: params.bankCode,
          accountNumber: params.accountNumber,
          transactionPin: params.transactionPin,
          ...(params.narration ? { narration: params.narration } : {}),
        });

        const data = response.data;
        const output = {
          reference: data.reference,
          status: data.status,
          amount: data.amount,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        return toMcpError(error, "monei_send_naira_to_bank");
      }
    }
  );

  // ─── send_naira_to_user ───────────────────────────────────────────────────
  server.registerTool(
    "monei_send_naira_to_user",
    {
      title: "Send Naira to Monei User",
      description: `Sends NGN to another Monei user identified by their email address or phone number.

This is faster than a bank transfer and works instantly between Monei users. Use this when the recipient is identified by email or phone rather than a bank account number.

Before calling:
1. Confirm sufficient NGN balance using monei_get_wallet
2. Ask for the user's transaction PIN if not provided — never store or log it

Args:
  - amount (number): Amount in NGN to send (e.g. 5000 for ₦5,000)
  - receiver (string): Recipient's registered Monei email or phone number (e.g. "john@gmail.com" or "08012345678")
  - transactionPin (string): User's 4-6 digit transaction PIN — ask for this at runtime

Returns:
{
  "reference": string,
  "status": string,
  "amount": number,
  "currency": "NGN",
  "receiver": string,
  "createdAt": string
}

Examples:
  - "Send ₦5,000 to john@gmail.com" -> receiver: "john@gmail.com"
  - "Transfer 2000 naira to 08012345678" -> receiver: "08012345678"

Error handling:
  - Returns error if the receiver is not a registered Monei user
  - Returns error if insufficient balance

Security: Never log or store the transactionPin. Pass it directly to this call only.`,
      inputSchema: SendNairaToUserSchema,
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

        const response = await sdk.payout.peerTransfer({
          amount: params.amount,
          receiver: params.receiver,
          transactionPin: params.transactionPin,
        });

        const data = response.data;
        const output = {
          reference: data.reference,
          status: data.status,
          amount: data.amount,
          currency: data.currency ?? "NGN",
          receiver: data.receiver ?? params.receiver,
          createdAt: data.createdAt,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        return toMcpError(error, "monei_send_naira_to_user");
      }
    }
  );
}