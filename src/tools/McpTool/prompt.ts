export const MCP_TOOL_PROMPT = `McpTool allows you to interact with external Model Context Protocol (MCP) servers configured on the user's system.

Available Actions:
1. "list_servers":
   - Inspect which MCP servers are configured, their transport types (stdio/http), and status (enabled/disabled).
   - Use this to discover external capabilities available in this environment.

2. "list_tools":
   - Inspect the available tools, their descriptions, and parameters for a specific MCP server.
   - Requires parameter: "server".

3. "call":
   - Execute an MCP tool on a specified server.
   - Requires parameters: "server", "tool", and "args" (object containing the arguments).
   - MCP tool executions may require user authorization unless pre-allowed.

Rules:
- Never assume an MCP tool exists without first inspecting via "list_servers" and "list_tools".
- If an MCP tool execution is denied by the user, do not retry the exact same call repeatedly; report the blocker clearly.`
