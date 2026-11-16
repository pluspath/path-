import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { env } from "../env";

/**
 * AES-256-GCM encryption for admin-managed secrets at rest.
 * Master key: CONFIG_ENCRYPTION_KEY (server-only). Never log plaintext or key material.
 *
 * Ciphertext format: enc:v1:<iv_b64>:<tag_b64>:<ciphertext_b64>
 */

const PREFIX = "enc:v1:";

function resolveKeyMaterial(): Buffer | null {
  const raw = env.CONFIG_ENCRYPTION_KEY?.trim();
  if (!raw) return null;

  // Prefer 64-char hex (32 bytes). Otherwise derive a stable 32-byte key via SHA-256.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  return createHash("sha256").update(raw, "utf8").digest();
}

export function isEncryptionConfigured(): boolean {
  return !!resolveKeyMaterial();
}

export function encryptSecret(plaintext: string): string {
  const key = resolveKeyMaterial();
  if (!key) {
    throw new Error(
      "CONFIG_ENCRYPTION_KEY is not configured. Set a 64-char hex key (openssl rand -hex 32) before storing secrets."
    );
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const key = resolveKeyMaterial();
  if (!key) {
    throw new Error("CONFIG_ENCRYPTION_KEY is not configured — cannot decrypt secrets.");
  }
  if (!payload.startsWith(PREFIX)) {
    throw new Error("Unsupported secret ciphertext format.");
  }
  const parts = payload.slice(PREFIX.length).split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed secret ciphertext.");
  }
  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64!, "base64");
  const tag = Buffer.from(tagB64!, "base64");
  const data = Buffer.from(dataB64!, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** Safe for logs / audit — never includes secret material. */
export function redactForLog(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  if (s.length <= 4) return "****";
  return `${s.slice(0, 2)}…(${s.length} chars)`;
}
