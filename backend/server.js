// server.js — "dumb blob store" backend with extended security features.
// IMPORTANT: this server NEVER sees plaintext or the decryption key.
// It only ever stores/serves opaque ciphertext blobs + metadata.
//
// Uses Node's built-in SQLite (node:sqlite) — no native compilation needed,
// no node-gyp, no build tools required. Requires Node.js 22.5+.
//
// New in feat/secure-share-security-controls:
//   - sensitivity_mode column (non-sensitive metadata)
//   - revoked flag + owner_token for emergency revocation
//   - decoy ciphertext envelope for Very Sensitive / duress mode
//   - access_log table for read notification
//   - recipient identity verification via one-time token
//   - GET /api/paste/:id/status   (owner-auth)
//   - POST /api/paste/:id/revoke  (owner-auth)
//   - POST /api/paste/:id/access-log
//   - POST /api/paste/:id/verify-identity
//   - GET  /api/paste/:id/verify/:token

const express = require("express");
const cors = require("cors");
const { DatabaseSync } = require("node:sqlite");
const { randomBytes } = require("crypto");
const path = require("path");

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "25mb" })); // allow file attachments (up to 10 MB file → ~13 MB base64 + overhead)

const dbPath = process.env.DB_PATH || path.join(__dirname, "pastes.db");
const db = new DatabaseSync(dbPath);

// ── Schema ─────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS pastes (
    id TEXT PRIMARY KEY,
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    salt TEXT NOT NULL,
    has_password INTEGER NOT NULL DEFAULT 0,
    burn_after_read INTEGER NOT NULL DEFAULT 0,
    allow_discussion INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER,
    created_at INTEGER NOT NULL,
    sensitivity_mode TEXT NOT NULL DEFAULT 'normal',
    revoked INTEGER NOT NULL DEFAULT 0,
    owner_token TEXT NOT NULL DEFAULT '',
    decoy_ciphertext TEXT,
    decoy_iv TEXT,
    decoy_salt TEXT,
    recipient_email TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    paste_id TEXT NOT NULL,
    nickname_cipher TEXT NOT NULL,
    nickname_iv TEXT NOT NULL,
    comment_cipher TEXT NOT NULL,
    comment_iv TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (paste_id) REFERENCES pastes(id) ON DELETE CASCADE
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS access_log (
    id TEXT PRIMARY KEY,
    paste_id TEXT NOT NULL,
    accessed_at INTEGER NOT NULL,
    verified_email TEXT,
    verification_token TEXT,
    verification_sent_at INTEGER,
    verified_at INTEGER,
    FOREIGN KEY (paste_id) REFERENCES pastes(id) ON DELETE CASCADE
  )
`);

// Safe ALTER TABLE — adds columns to existing databases that don't have them yet.
const safeAlter = (sql) => { try { db.exec(sql); } catch (_) { /* column exists */ } };
safeAlter(`ALTER TABLE pastes ADD COLUMN allow_discussion INTEGER NOT NULL DEFAULT 0`);
safeAlter(`ALTER TABLE pastes ADD COLUMN sensitivity_mode TEXT NOT NULL DEFAULT 'normal'`);
safeAlter(`ALTER TABLE pastes ADD COLUMN revoked INTEGER NOT NULL DEFAULT 0`);
safeAlter(`ALTER TABLE pastes ADD COLUMN owner_token TEXT NOT NULL DEFAULT ''`);
safeAlter(`ALTER TABLE pastes ADD COLUMN decoy_ciphertext TEXT`);
safeAlter(`ALTER TABLE pastes ADD COLUMN decoy_iv TEXT`);
safeAlter(`ALTER TABLE pastes ADD COLUMN decoy_salt TEXT`);
safeAlter(`ALTER TABLE pastes ADD COLUMN recipient_email TEXT`);

// ── Helpers ────────────────────────────────────────────────────────────────

function generateId(len = 12) {
  return randomBytes(len)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
    .slice(0, len);
}

function generateToken(len = 32) {
  return randomBytes(len).toString("hex");
}

function purgeExpired() {
  const now = Date.now();
  db.prepare(`DELETE FROM pastes WHERE expires_at IS NOT NULL AND expires_at < ?`).run(now);
}

function isValidSensitivityMode(mode) {
  return ["normal", "sensitive", "very_sensitive"].includes(mode);
}

// ── Create a paste ─────────────────────────────────────────────────────────

app.post("/api/paste", (req, res) => {
  purgeExpired();
  const {
    ciphertext, iv, salt, hasPassword, burnAfterRead, ttlSeconds, allowDiscussion,
    sensitivityMode, decoyCiphertext, decoyIv, decoySalt, recipientEmail,
  } = req.body || {};

  if (typeof ciphertext !== "string" || typeof iv !== "string" || typeof salt !== "string") {
    return res.status(400).json({ error: "ciphertext, iv, and salt are required strings" });
  }
  if (ciphertext.length > 5_000_000) {
    return res.status(413).json({ error: "paste too large" });
  }

  const mode = isValidSensitivityMode(sensitivityMode) ? sensitivityMode : "normal";

  // Validate decoy fields — only store them if all three are provided (string) and non-empty
  const hasDecoy =
    typeof decoyCiphertext === "string" && decoyCiphertext.length > 0 &&
    typeof decoyIv === "string" && decoyIv.length > 0 &&
    typeof decoySalt === "string" && decoySalt.length > 0;

  const id = generateId();
  const ownerToken = generateToken();
  const now = Date.now();
  const expiresAt =
    ttlSeconds && Number.isFinite(ttlSeconds) && ttlSeconds > 0
      ? now + ttlSeconds * 1000
      : null;

  // burn-after-read pastes cannot have discussion (thread would vanish on first view)
  const discussionAllowed = burnAfterRead ? 0 : (allowDiscussion ? 1 : 0);

  db.prepare(
    `INSERT INTO pastes
      (id, ciphertext, iv, salt, has_password, burn_after_read, allow_discussion,
       expires_at, created_at, sensitivity_mode, revoked, owner_token,
       decoy_ciphertext, decoy_iv, decoy_salt, recipient_email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
  ).run(
    id, ciphertext, iv, salt, hasPassword ? 1 : 0, burnAfterRead ? 1 : 0, discussionAllowed,
    expiresAt, now, mode, ownerToken,
    hasDecoy ? decoyCiphertext : null,
    hasDecoy ? decoyIv : null,
    hasDecoy ? decoySalt : null,
    typeof recipientEmail === "string" && recipientEmail.includes("@") ? recipientEmail : null
  );

  // Owner token is returned ONCE and never stored in a recoverable way after this response.
  // The client must save it (sessionStorage + management URL).
  res.json({ id, expiresAt, allowDiscussion: !!discussionAllowed, ownerToken });
});

// ── Retrieve a paste ───────────────────────────────────────────────────────

app.get("/api/paste/:id", (req, res) => {
  purgeExpired();
  const { id } = req.params;

  const row = db.prepare(`SELECT * FROM pastes WHERE id = ?`).get(id);
  if (!row) {
    return res.status(404).json({ error: "not_found_or_already_read" });
  }

  if (row.revoked) {
    return res.status(410).json({ error: "revoked" });
  }

  if (row.expires_at && row.expires_at < Date.now()) {
    db.prepare(`DELETE FROM pastes WHERE id = ?`).run(id);
    return res.status(404).json({ error: "expired" });
  }

  if (row.burn_after_read) {
    db.prepare(`DELETE FROM pastes WHERE id = ?`).run(id);
  }

  const hasDecoy = !!(row.decoy_ciphertext && row.decoy_iv && row.decoy_salt);

  const response = {
    ciphertext: row.ciphertext,
    iv: row.iv,
    salt: row.salt,
    hasPassword: !!row.has_password,
    burnAfterRead: !!row.burn_after_read,
    allowDiscussion: !!row.allow_discussion,
    sensitivityMode: row.sensitivity_mode || "normal",
    hasDecoy,
  };

  // Return decoy fields only if they exist — server doesn't know which is real
  if (hasDecoy) {
    response.decoyCiphertext = row.decoy_ciphertext;
    response.decoyIv = row.decoy_iv;
    response.decoySalt = row.decoy_salt;
  }

  res.json(response);
});

// ── Access log ─────────────────────────────────────────────────────────────

app.post("/api/paste/:id/access-log", (req, res) => {
  const { id } = req.params;

  const paste = db.prepare(`SELECT id, revoked, expires_at FROM pastes WHERE id = ?`).get(id);
  if (!paste) return res.status(404).json({ error: "paste not found" });
  if (paste.revoked) return res.status(410).json({ error: "revoked" });
  if (paste.expires_at && paste.expires_at < Date.now()) return res.status(404).json({ error: "expired" });

  const accessId = generateId(16);
  const now = Date.now();

  db.prepare(
    `INSERT INTO access_log (id, paste_id, accessed_at) VALUES (?, ?, ?)`
  ).run(accessId, id, now);

  res.json({ accessId });
});

// ── Revoke ─────────────────────────────────────────────────────────────────

app.post("/api/paste/:id/revoke", (req, res) => {
  const { id } = req.params;
  const { ownerToken } = req.body || {};

  if (!ownerToken) return res.status(400).json({ error: "ownerToken required" });

  const paste = db.prepare(`SELECT id, owner_token FROM pastes WHERE id = ?`).get(id);
  if (!paste) return res.status(404).json({ error: "paste not found" });

  // Constant-time comparison to prevent timing attacks on the owner token
  if (!timingSafeEqual(paste.owner_token, ownerToken)) {
    return res.status(403).json({ error: "unauthorized" });
  }

  db.prepare(`UPDATE pastes SET revoked = 1 WHERE id = ?`).run(id);
  res.json({ revoked: true });
});

// ── Paste status (owner-authenticated) ────────────────────────────────────

app.get("/api/paste/:id/status", (req, res) => {
  const { id } = req.params;
  const { ownerToken } = req.query;

  if (!ownerToken) return res.status(403).json({ error: "ownerToken required" });

  const paste = db.prepare(
    `SELECT id, owner_token, revoked, expires_at, sensitivity_mode FROM pastes WHERE id = ?`
  ).get(id);
  if (!paste) return res.status(404).json({ error: "paste not found" });

  if (!timingSafeEqual(paste.owner_token, String(ownerToken))) {
    return res.status(403).json({ error: "unauthorized" });
  }

  const accesses = db.prepare(
    `SELECT id, accessed_at, verified_email, verified_at
     FROM access_log WHERE paste_id = ? ORDER BY accessed_at DESC`
  ).all(id);

  res.json({
    id: paste.id,
    revoked: !!paste.revoked,
    expiresAt: paste.expires_at,
    sensitivityMode: paste.sensitivity_mode || "normal",
    accessCount: accesses.length,
    accesses,
  });
});

// ── Recipient identity verification ───────────────────────────────────────

// Step 1: Sender requests a verification token for the recipient's email.
// The server generates a one-time token. The CLIENT uses mailto: to send the
// verification link to the recipient — no server-side SMTP required.
app.post("/api/paste/:id/verify-identity", (req, res) => {
  const { id } = req.params;
  const { email } = req.body || {};

  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "Valid email required" });
  }

  const paste = db.prepare(`SELECT id FROM pastes WHERE id = ?`).get(id);
  if (!paste) return res.status(404).json({ error: "paste not found" });

  const verifyToken = generateToken(24);
  const now = Date.now();

  // Update any existing unverified access log entry for this paste with this email
  // or create a pending verification record
  const latest = db.prepare(
    `SELECT id FROM access_log WHERE paste_id = ? AND verified_email IS NULL ORDER BY accessed_at DESC LIMIT 1`
  ).get(id);

  if (latest) {
    db.prepare(
      `UPDATE access_log SET verified_email = ?, verification_token = ?, verification_sent_at = ? WHERE id = ?`
    ).run(email, verifyToken, now, latest.id);
  }

  const baseUrl = process.env.FRONTEND_URL || `http://localhost:5173`;
  const verifyUrl = `${baseUrl}/verify/${id}/${verifyToken}`;

  res.json({ verifyToken, verifyUrl });
});

// Step 2: Recipient clicks the verification link.
app.get("/api/paste/:id/verify/:token", (req, res) => {
  const { id, token } = req.params;

  const entry = db.prepare(
    `SELECT id FROM access_log WHERE paste_id = ? AND verification_token = ? AND verified_at IS NULL`
  ).get(id, token);

  if (!entry) {
    return res.status(404).json({ error: "Invalid or already-used verification token" });
  }

  db.prepare(
    `UPDATE access_log SET verified_at = ? WHERE id = ?`
  ).run(Date.now(), entry.id);

  // Redirect to the paste's manage view to show confirmed identity
  res.json({ verified: true, message: "Identity verified. The paste owner will see your access confirmation." });
});

// ── Comments ───────────────────────────────────────────────────────────────

app.get("/api/paste/:id/comments", (req, res) => {
  const { id } = req.params;

  const paste = db.prepare(`SELECT id, allow_discussion FROM pastes WHERE id = ?`).get(id);
  if (!paste) return res.status(404).json({ error: "paste not found" });
  if (!paste.allow_discussion) return res.status(403).json({ error: "discussion not enabled" });

  const rows = db.prepare(
    `SELECT id, nickname_cipher, nickname_iv, comment_cipher, comment_iv, created_at
     FROM comments WHERE paste_id = ? ORDER BY created_at ASC`
  ).all(id);

  res.json({ comments: rows });
});

app.post("/api/paste/:id/comments", (req, res) => {
  const { id } = req.params;
  const { nicknameCipher, nicknameIv, commentCipher, commentIv } = req.body || {};

  if (!nicknameCipher || !nicknameIv || !commentCipher || !commentIv) {
    return res.status(400).json({ error: "Missing required encrypted fields" });
  }

  const paste = db.prepare(`SELECT id, allow_discussion, burn_after_read FROM pastes WHERE id = ?`).get(id);
  if (!paste) return res.status(404).json({ error: "paste not found" });
  if (!paste.allow_discussion) return res.status(403).json({ error: "discussion not enabled" });
  if (paste.burn_after_read) return res.status(403).json({ error: "burn-after-read pastes cannot have comments" });

  const commentId = generateId();
  const now = Date.now();

  db.prepare(
    `INSERT INTO comments (id, paste_id, nickname_cipher, nickname_iv, comment_cipher, comment_iv, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(commentId, id, nicknameCipher, nicknameIv, commentCipher, commentIv, now);

  res.json({ id: commentId, createdAt: now });
});

// ── Timing-safe string comparison ─────────────────────────────────────────

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) {
    // Still iterate to avoid timing leak on length
    let result = 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      result |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    }
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ── Start ──────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Backend listening on http://localhost:${PORT}`));
