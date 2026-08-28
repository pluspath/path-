import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { env } from "../env";

function getEncryptionKey(): Buffer {
  const secret =
    process.env.CONFIG_ENCRYPTION_KEY?.trim() ||
    env.BETTER_AUTH_SECRET?.trim() ||
    env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    "pathplus-pending-registration-key";
  return createHash("sha256").update(secret).digest();
}

/** Encrypt a short-lived secret (e.g. pending registration password). */
export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

/** Decrypt a value produced by encryptSecret. */
export function decryptSecret(payload: string): string {
  const [ivPart, tagPart, dataPart] = payload.split(".");
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error("Invalid encrypted payload");
  }
  const key = getEncryptionKey();
  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const data = Buffer.from(dataPart, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
