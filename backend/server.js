// server.js — minimal "dumb blob store" backend.
// IMPORTANT: this server NEVER sees plaintext or the decryption key.
// It only ever stores/serves opaque ciphertext blobs + metadata.
//
// Uses Node's built-in SQLite (node:sqlite) — no native compilation needed,
// no node-gyp, no build tools required. Requires Node.js 22.5+.

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
    created_at INTEGER NOT NULL
  )
`);

// Add allow_discussion column to existing databases that don't have it yet
try {
  db.exec(`ALTER TABLE pastes ADD COLUMN allow_discussion INTEGER NOT NULL DEFAULT 0`);
} catch (_) { /* column already exists — ignore */ }

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

// Simple URL-safe random id generator (replaces nanoid)
function generateId(len = 12) {
  return randomBytes(len)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
    .slice(0, len);
}

function purgeExpired() {
  const now = Date.now();
  db.prepare(`DELETE FROM pastes WHERE expires_at IS NOT NULL AND expires_at < ?`).run(now);
}

// --- Create a paste ---
app.post("/api/paste", (req, res) => {
  purgeExpired();
  const { ciphertext, iv, salt, hasPassword, burnAfterRead, ttlSeconds, allowDiscussion } = req.body || {};

  if (typeof ciphertext !== "string" || typeof iv !== "string" || typeof salt !== "string") {
    return res.status(400).json({ error: "ciphertext, iv, and salt are required strings" });
  }
  if (ciphertext.length > 5_000_000) {
    return res.status(413).json({ error: "paste too large" });
  }

  const id = generateId();
  const now = Date.now();
  const expiresAt =
    ttlSeconds && Number.isFinite(ttlSeconds) && ttlSeconds > 0
      ? now + ttlSeconds * 1000
      : null;

  // burn-after-read pastes cannot have discussion (thread would vanish on first view)
  const discussionAllowed = burnAfterRead ? 0 : (allowDiscussion ? 1 : 0);

  db.prepare(
    `INSERT INTO pastes (id, ciphertext, iv, salt, has_password, burn_after_read, allow_discussion, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, ciphertext, iv, salt, hasPassword ? 1 : 0, burnAfterRead ? 1 : 0, discussionAllowed, expiresAt, now);

  res.json({ id, expiresAt, allowDiscussion: !!discussionAllowed });
});

// --- Retrieve a paste ---
app.get("/api/paste/:id", (req, res) => {
  purgeExpired();
  const { id } = req.params;

  const row = db.prepare(`SELECT * FROM pastes WHERE id = ?`).get(id);
  if (!row) {
    return res.status(404).json({ error: "not_found_or_already_read" });
  }

  if (row.expires_at && row.expires_at < Date.now()) {
    db.prepare(`DELETE FROM pastes WHERE id = ?`).run(id);
    return res.status(404).json({ error: "expired" });
  }

  if (row.burn_after_read) {
    db.prepare(`DELETE FROM pastes WHERE id = ?`).run(id);
  }

  res.json({
    ciphertext: row.ciphertext,
    iv: row.iv,
    salt: row.salt,
    hasPassword: !!row.has_password,
    burnAfterRead: !!row.burn_after_read,
    allowDiscussion: !!row.allow_discussion,
  });
});

// --- Get comments for a paste ---
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

// --- Post a comment ---
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

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Backend listening on http://localhost:${PORT}`));
