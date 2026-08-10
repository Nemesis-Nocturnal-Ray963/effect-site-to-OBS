import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

function safeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyApiKey(request: FastifyRequest, reply: FastifyReply, apiKey: string): boolean {
  const authHeader = request.headers.authorization;
  const bearerToken =
    typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : null;
  const headerToken = request.headers["x-effect-app-key"];
  const token = typeof headerToken === "string" ? headerToken : bearerToken;

  if (!token || !safeEquals(token, apiKey)) {
    reply.code(401).send({ accepted: false, error: "Unauthorized" });
    return false;
  }

  return true;
}
