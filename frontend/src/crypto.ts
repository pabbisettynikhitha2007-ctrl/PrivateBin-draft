// crypto.ts — ALL encryption/decryption happens here, in the browser.
// The server NEVER sees plaintext and NEVER sees the key.
// The key only ever lives in the URL fragment (after #), which browsers
// never send to the server in HTTP requests — that's the whole trick.
//
// Optional password support: if a password is set, the final AES key is
// derived from BOTH the random URL-fragment key AND the password via
// PBKDF2. That means someone with only the link (no password) CANNOT
// decrypt — they need both pieces, same as original PrivateBin's model.

export type PasteFormat = "plain" | "markdown" | "source";

export interface FileAttachment {
  name: string;   // original filename
  type: string;   // MIME type
  data: string;   // base64-encoded file bytes
  size: number;   // original byte size
}

export interface PastePayload {
  content: string;
  format: PasteFormat;
  file?: FileAttachment; // optional encrypted file attachment
}

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBuf(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function toUrlSafeB64(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromUrlSafeB64(b64: string): string {
  return b64.replace(/-/g, "+").replace(/_/g, "/");
}

// Generate the random key that lives in the URL fragment.
async function generateRawKey(): Promise<{ raw: ArrayBuffer; rawKeyB64: string }> {
  const raw = crypto.getRandomValues(new Uint8Array(32)).buffer; // 256-bit
  return { raw, rawKeyB64: toUrlSafeB64(bufToBase64(raw)) };
}

// Derive the actual AES-GCM encryption key from the URL key (+ optional password)
// using PBKDF2. Without a password, this just re-derives a stable key from the
// raw bytes with a fixed empty passphrase component (still 256-bit random, so
// it's already strong) — the extra derivation step is skipped when no password
// is set, saving a bit of compute.
async function deriveAesKey(
  rawKeyBytes: ArrayBuffer,
  password: string | null,
  saltInput: Uint8Array
): Promise<CryptoKey> {
  // Copy into a fresh, plain ArrayBuffer-backed Uint8Array to satisfy TS's
  // strict BufferSource typing for subtle.deriveKey's salt parameter.
  const salt = new Uint8Array(saltInput);
  if (!password) {
    // No password: use the raw random bytes directly as the AES key.
    return crypto.subtle.importKey("raw", rawKeyBytes, "AES-GCM", true, [
      "encrypt",
      "decrypt",
    ]);
  }

  // Password set: combine the URL key bytes + password into PBKDF2 input.
  // Both the link AND the password are required to reconstruct this key.
  const encoder = new TextEncoder();
  const combined = new Uint8Array(rawKeyBytes.byteLength + encoder.encode(password).length);
  combined.set(new Uint8Array(rawKeyBytes), 0);
  combined.set(encoder.encode(password), rawKeyBytes.byteLength);

  const baseKey = await crypto.subtle.importKey("raw", combined, "PBKDF2", false, [
    "deriveKey",
  ]);

  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 250_000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function encryptPaste(
  payload: PastePayload,
  password: string | null
): Promise<{ ciphertext: string; iv: string; salt: string; keyB64: string; hasPassword: boolean }> {
  const { raw, rawKeyB64 } = await generateRawKey();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveAesKey(raw, password, salt);

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);

  return {
    ciphertext: bufToBase64(cipherBuf),
    iv: bufToBase64(iv.buffer),
    salt: bufToBase64(salt.buffer),
    keyB64: rawKeyB64,
    hasPassword: !!password,
  };
}

export async function decryptPaste(
  ciphertextB64: string,
  ivB64: string,
  saltB64: string,
  keyB64: string,
  password: string | null
): Promise<PastePayload> {
  const rawKeyBytes = base64ToBuf(fromUrlSafeB64(keyB64));
  const salt = new Uint8Array(base64ToBuf(saltB64));
  const key = await deriveAesKey(rawKeyBytes, password, salt);

  const iv = new Uint8Array(base64ToBuf(ivB64));
  const cipherBuf = base64ToBuf(ciphertextB64);

  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipherBuf);
  const json = new TextDecoder().decode(plainBuf);
  return JSON.parse(json) as PastePayload;
}

// --- Comment encryption (uses the paste's URL key directly, no password) ---

/** Encrypt a short string (nickname or comment text) using the paste's URL key. */
export async function encryptComment(
  text: string,
  keyB64: string
): Promise<{ cipher: string; iv: string }> {
  const rawKeyBytes = base64ToBuf(fromUrlSafeB64(keyB64));
  const key = await crypto.subtle.importKey("raw", rawKeyBytes, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(text);
  const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  return { cipher: bufToBase64(cipherBuf), iv: bufToBase64(iv.buffer) };
}

/** Decrypt a comment field using the paste's URL key. */
export async function decryptComment(
  cipherB64: string,
  ivB64: string,
  keyB64: string
): Promise<string> {
  const rawKeyBytes = base64ToBuf(fromUrlSafeB64(keyB64));
  const key = await crypto.subtle.importKey("raw", rawKeyBytes, "AES-GCM", false, ["decrypt"]);
  const iv = new Uint8Array(base64ToBuf(ivB64));
  const cipherBuf = base64ToBuf(cipherB64);
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipherBuf);
  return new TextDecoder().decode(plainBuf);
}
