import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createClient } from "../client.js";
import { toMcpError } from "../errors.js";
import { ReferenceSchema } from "../schemas/shared.schema.js";

export function registerTransactionTools(server: McpServer, apiKey?: string): void {

  // ─── get_transaction_history ──────────────────────────────────────────────
  server.registerTool(
    "monei_get_transaction_history",
    {
      title: "Get Transaction History",
      description: `Returns the user's recent transaction history across all transaction types.

Use this when the user wants to review past activity, check if a payment went through, or audit recent sends, swaps, or bill payments.

Returns:
{
  "transactions": [
    {
      "id": string,
      "reference": string,
      "type": string,          // e.g. "OFFRAMP", "SWAP", "TRANSFER", "BILL_PAYMENT"
      "nature": string,        // e.g. "DEBIT" | "CREDIT"
      "amount": number,
      "currency": string,
      "status": string,        // e.g. "COMPLETED", "PENDING", "FAILED"
      "narration": string,
      "createdAt": string
    }
  ]
}

Examples:
  - "Show my recent transactions" -> call this
  - "Did my USDT sale go through?" -> call this, filter by type=OFFRAMP
  - "What did I spend money on recently?" -> call this, show narration fields`,
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
        const response = await sdk.transactions.getUserTransactions();
        const transactions = response.data.transactions;

        const output = {
          transactions: (transactions ?? []).map((tx) => ({
            id: tx.id,
            reference: tx.reference,
            type: tx.type,
            //nature: tx.nature,
            amount: tx.amount,
            currency: tx.currency,
            status: tx.status,
            narration: tx.narration ?? null,
            createdAt: tx.createdAt,
          })),
        };

        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        return toMcpError(error, "monei_get_transaction_history");
      }
    }
  );

  // ─── get_transaction ──────────────────────────────────────────────────────
  server.registerTool(
    "monei_get_transaction",
    {
      title: "Get Transaction",
      description: `Returns the full details of a single transaction by its reference string.

Use this when the user provides a specific transaction reference and wants to know its current status or details. For browsing recent activity, use monei_get_transaction_history instead.

Args:
  - reference (string): Transaction reference returned from a previous operation (e.g. "TXN_abc123xyz")

Returns:
{
  "id": string,
  "reference": string,
  "type": string,
  "nature": string,
  "amount": number,
  "currency": string,
  "status": string,
  "narration": string | null,
  "metadata": object | null,
  "createdAt": string,
  "updatedAt": string
}

Examples:
  - "What's the status of transaction TXN_abc123?" -> reference="TXN_abc123"
  - "Show me the details for ref_456xyz" -> reference="ref_456xyz"

Error handling:
  - Returns error if the reference does not exist or belongs to a different user`,
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
        const response = await sdk.transactions.getByReference(reference as string);
        const tx = response;

        const output = {
          id: tx.id,
          reference: tx.reference,
          type: tx.type,
          nature: tx.nature,
          amount: tx.amount,
          currency: tx.currency,
          status: tx.status,
          narration: tx.narration ?? null,
          metadata: tx.metadata ?? null,
          createdAt: tx.createdAt,
          updatedAt: tx.updatedAt,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        return toMcpError(error, "monei_get_transaction");
      }
    }
  );
}