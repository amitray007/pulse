import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Pool } from "@pulse/db";
import { createMcpServer } from "./server.js";
import { isAuthorized } from "./auth.js";

// Serves the Pulse MCP over HTTP with a bearer-token gate. Stateless transport (a fresh transport
// per request, no session) keeps it simple — this is a single-tenant operator tool, not a
// multi-session app. The token is the security boundary; deploy the MCP off the public internet.
export function buildHttpServer(pool: Pool, authToken: string): Server {
  return createServer((req, res) => {
    void handle(req, res, pool, authToken);
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  pool: Pool,
  authToken: string,
): Promise<void> {
  if (req.method === "GET" && req.url === "/health") {
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (!isAuthorized(req, authToken)) {
    res
      .writeHead(401, { "content-type": "application/json" })
      .end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

  const mcp = createMcpServer(pool);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void mcp.close();
  });

  try {
    await mcp.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    if (!res.headersSent) {
      res
        .writeHead(500, { "content-type": "application/json" })
        .end(JSON.stringify({ error: "internal error" }));
    }
    console.error("mcp request failed:", err);
  }
}
