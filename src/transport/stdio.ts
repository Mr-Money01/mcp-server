import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

/**
 * Runs the MCP server over stdio.
 *
 * This is the transport used for local integrations:
 * Claude Desktop, Cursor, and any LLM runner that spawns
 * the server as a subprocess.
 *
 * stdio servers must never write to stdout — all logging
 * goes to stderr so it does not corrupt the MCP protocol stream.
 */
export async function runStdio(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[monei-mcp] Server running on stdio");
}