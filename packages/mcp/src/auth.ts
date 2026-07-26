import type { IncomingMessage } from "node:http";
import { timingSafeEqual } from "node:crypto";

/** Constant-time compare of two strings, false if lengths differ. */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Check the Authorization header against the expected bearer token.
 * The MCP has full DB power, so every request must present the token.
 */
export function isAuthorized(
  req: Pick<IncomingMessage, "headers">,
  expectedToken: string,
): boolean {
  const header = req.headers.authorization;
  if (typeof header !== "string") return false;
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return false;
  return safeEqual(token, expectedToken);
}
