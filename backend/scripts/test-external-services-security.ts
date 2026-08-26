// Set before any module that loads src/env.ts
process.env.CONFIG_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const { encryptSecret, decryptSecret, isEncryptionConfigured } = await import(
  "../src/lib/secret-crypto"
);
const { isAllowedPublicAppUrl } = await import("../src/lib/external-config");
const { parseServiceId } = await import("../src/admin/services/external-services.service");

const sample = "re_test_secret_value_never_log_me";
const enc = encryptSecret(sample);
const dec = decryptSecret(enc);
if (dec !== sample) throw new Error("encrypt/decrypt mismatch");
if (enc.includes(sample)) throw new Error("plaintext leaked into ciphertext");
if (!isEncryptionConfigured()) throw new Error("encryption should be configured");

if (!isAllowedPublicAppUrl("https://site.pathplus.store")) throw new Error("allowlist fail");
if (isAllowedPublicAppUrl("https://evil.example.com")) throw new Error("open redirect not blocked");
if (parseServiceId("email") !== "email") throw new Error("parseServiceId");
if (parseServiceId("smtp") !== null) throw new Error("unknown service should be null");

console.log("security unit checks passed");
