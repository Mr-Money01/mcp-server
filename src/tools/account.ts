import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createClient } from "../client.js";
import { toMcpError } from "../errors.js";

export function registerAccountTools(server: McpServer, apiKey?: string): void {
  server.registerTool(
    "monei_get_account",
    {
      title: "Get Account",
      description: `Returns the profile of the currently authenticated Monei user.

Use this at the start of a session to identify who is logged in, confirm the user's name and email, or check their verification status before proceeding with financial operations.

Returns:
{
  "id": string,               // Internal user ID
  "firstName": string,
  "lastName": string,
  "email": string,
  "phone": string,
  "verified": boolean,        // Whether the account is fully verified (KYC)
  "haveTransactionPin": boolean, // Whether the user has set a transaction PIN
  "lastLoggedIn": string      // ISO timestamp of last login
}

Examples:
  - "Who am I logged in as?" -> call this tool
  - "Is my account verified?" -> check 'verified' field in response
  - "Do I have a transaction PIN set?" -> check 'haveTransactionPin' field

Error handling:
  - Returns error if API key is invalid or expired
  - Returns error if the account has been suspended`,
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
        const response = await sdk.user.getCurrentUser();
        const user = response.data;

        const output = {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          name: user.name,
          email: user.email,
          phone: user.phone,
          verified: user.verified,
          haveTransactionPin: user.haveTransactionPin,
          lastLoggedIn: user.lastLoggedIn ?? null,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        return toMcpError(error, "monei_get_account");
      }
    }
  );
}