import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "crypto";
import { env } from "../../env";
import { JWT_AUDIENCE, JWT_ISSUER, type AdminRole } from "../constants";
import type { AdminJwtPayload } from "../types";

function getSecret() {
  const secret = env.ADMIN_JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("ADMIN_JWT_SECRET is not configured");
  }
  return new TextEncoder().encode(secret);
}

export async function signAdminToken(input: {
  id: string;
  username: string;
  role: AdminRole;
}): Promise<{ token: string; jti: string; expiresAt: Date }> {
  const jti = randomUUID();
  const expiresIn = env.ADMIN_JWT_EXPIRES_IN || "8h";
  const token = await new SignJWT({
    username: input.username,
    role: input.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.id)
    .setJti(jti)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(getSecret());

  const expiresAt = new Date(Date.now() + parseExpiresMs(expiresIn));
  return { token, jti, expiresAt };
}

export async function verifyAdminToken(token: string): Promise<AdminJwtPayload> {
  const { payload } = await jwtVerify(token, getSecret(), {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });

  if (!payload.sub || !payload.jti || typeof payload.username !== "string" || typeof payload.role !== "string") {
    throw new Error("Invalid admin token payload");
  }

  return {
    sub: payload.sub,
    jti: payload.jti,
    username: payload.username,
    role: payload.role as AdminRole,
  };
}

function parseExpiresMs(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match) return 8 * 60 * 60 * 1000;
  const n = Number(match[1]);
  const unit = match[2];
  switch (unit) {
    case "s":
      return n * 1000;
    case "m":
      return n * 60 * 1000;
    case "h":
      return n * 60 * 60 * 1000;
    case "d":
      return n * 24 * 60 * 60 * 1000;
    default:
      return 8 * 60 * 60 * 1000;
  }
}
