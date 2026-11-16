import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { env } from "../env";

let cachedKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  const secret =
    process.env.CONFIG_ENCRYPTION_KEY?.trim() ||
    env.BETTER_AUTH_SECRET?.trim() ||
    env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!secret) {
    const isProd = (env.NODE_ENV ?? process.env.NODE_ENV) === "production";
    if (isProd) {
      throw new Error(
        "CONFIG_ENCRYPTION_KEY (or BETTER_AUTH_SECRET / SUPABASE_SERVICE_ROLE_KEY) is required in production"
      );
    }
    console.warn(
      "[secure-storage] No encryption secret configured — using a process-local dev key. Set CONFIG_ENCRYPTION_KEY."
    );
    cachedKey = createHash("sha256").update(`dev-only:${process.pid}`).digest();
    return cachedKey;
  }

  cachedKey = createHash("sha256").update(secret).digest();
  return cachedKey;
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
