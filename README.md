# SecureShare

**Zero-knowledge end-to-end encrypted text and file sharing.**

The server never sees your plaintext. The decryption key lives exclusively in the URL fragment (`#`) — which browsers never send in HTTP requests.

---

## Features

### Core (existing)
- AES-256-GCM encryption, all in the browser
- PBKDF2-based password protection (URL key + password, 250,000 iterations)
- Burn-after-read (self-destruct on first view)
- Configurable expiry (10 min → 1 week → never)
- Encrypted file attachments (up to 10 MB)
- Encrypted comments/discussion threads
- Session caching (no re-fetch on refresh)
- 22-language UI (English, Hindi, Arabic, Chinese, Japanese, Korean, and more)

### New — Security Controls (v2)

#### 1. Password Strength Meter
Live password strength feedback while typing. Levels: **Weak / Fair / Strong / Very Strong**. Checks length, character variety, common patterns, repeats, sequential characters, and entropy. Runs entirely in the browser — password never transmitted.

#### 2. Three Sensitivity / Protection Modes
| Mode | Description |
|------|-------------|
| **Non-sensitive** | Standard sharing, relaxed defaults |
| **Sensitive** | Requires a password, shorter expiry suggestions, warning before creation |
| **Very Sensitive** | Dual-ciphertext duress mode — real password reveals real secret, duress password reveals a safe decoy message silently |

**Duress/decoy password security design:**
- Two independent AES-256-GCM ciphertexts are created (real + decoy), encrypted with different PBKDF2-derived keys
- The server stores both ciphertexts but has **no semantic flag** to distinguish which is real
- Decoy selection happens entirely client-side: try real password → success → show real content; if real fails → try decoy password → success → show decoy silently
- The UI response to both successful decryptions is visually identical to the viewer
- **The server cannot determine which password is "real"**

#### 3. Read Notification + Reader Identity
- Every view is logged (anonymous timestamp only)
- Sender can request a **one-time identity verification token** for a recipient email
- Token is delivered via a `mailto:` link the sender controls (no server-side SMTP)
- When recipient clicks the verification link, their email is associated with the access log entry
- Access log clearly distinguishes: `✓ Viewed by verified recipient` vs `Viewer identity unavailable`

#### 4. Local Rule-Based Sensitivity Suggestion
Client-side regex/heuristic content analyzer (no cloud AI, no external service).
Detects: API keys, JWTs, private keys, database connection strings, credit card patterns, SSNs, high-entropy tokens, passwords in assignments, security keywords, email addresses, phone numbers.
Suggests: **Sensitive** or **Very Sensitive** mode. User always remains in control.

#### 5. More Sharing Options
- **QR Code** — client-side generation (qrcode library), full URL including `#fragment` key, downloadable PNG
- **Email sharing** — `mailto:` link with prefilled subject and body. Server never transmits the secret.

#### 6. Emergency Revoke
- Creator receives a one-time **owner token** at paste creation (returned once, stored in sessionStorage + management URL)
- Owner can revoke at any time via the `/manage/:id` interface
- Revoked pastes return `410 Gone` — no ciphertext is retrievable
- Owner token is verified server-side with timing-safe comparison
- **Honest disclaimer shown in UI**: revocation prevents new server-side retrievals; it cannot erase content already decrypted in a recipient's browser

#### 7. "What Does the Server See?" Transparency View
Expandable panel showing the **actual** server payload (real ciphertext, IV, salt, metadata). Not fake/demo data — the real values produced by the encryption pipeline. Clearly shows what the server does and does not have access to.

---

## Security Architecture

```
                    Browser only                Server (blind)
                 ┌──────────────────┐         ┌──────────────┐
 Your plaintext  │  AES-256-GCM     │         │  ciphertext  │
 ──────────────► │  encryption      │ ──────► │  IV          │
                 │                  │         │  salt        │
 URL #fragment   │  PBKDF2 key      │         │  has_password│
 key (256-bit)   │  derivation      │         │  sensitivity │
 ──────────────► │                  │         │  mode        │
                 │  (optional)      │         │  revoked     │
 Password        │  + password      │         │  expires_at  │
 ──────────────► │                  │         └──────────────┘
                 └──────────────────┘
                                                  Server sees:
                                                  NONE of the above
                                                  in plaintext form
```

**The URL fragment (`#key`) is never sent to the server.** Browsers strip the fragment before making HTTP requests. This is the fundamental security guarantee.

---

## Running Locally

### Prerequisites
- Node.js 22.5+ (for `node:sqlite`)
- npm

### Development

```bash
# Backend
cd backend
npm install
npm start          # runs on :4000

# Frontend (new terminal)
cd frontend
npm install
npm run dev        # runs on :5173
```

### Docker

```bash
docker compose up --build
```

Frontend: http://localhost:5173  
Backend API: http://localhost:4000/api

---

## API Reference (new endpoints)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/paste` | — | Create paste (now accepts `sensitivityMode`, `decoyCiphertext/Iv/Salt`, `recipientEmail`) |
| `GET` | `/api/paste/:id` | — | Retrieve paste (returns 410 if revoked, includes `hasDecoy` and decoy fields) |
| `POST` | `/api/paste/:id/access-log` | — | Record anonymous access event |
| `GET` | `/api/paste/:id/status` | `?ownerToken=` | Fetch access log + revocation status |
| `POST` | `/api/paste/:id/revoke` | `{ ownerToken }` | Emergency revoke |
| `POST` | `/api/paste/:id/verify-identity` | — | Generate one-time identity verification token |
| `GET` | `/api/paste/:id/verify/:token` | — | Confirm identity verification |

---

## Security Guarantees & Limitations

### Guaranteed
- Plaintext never transmitted to the server
- Decryption key never in HTTP request body (URL fragment only)
- Passwords never transmitted (used only in browser for key derivation)
- Plaintext never in server logs
- Duress password path indistinguishable from real password path server-side
- Owner token comparison is timing-safe (prevents timing attacks)
- QR code generated client-side (no server sees the link)

### Limitations (honest)
- **Revocation cannot erase already-decrypted content** from a recipient's memory or clipboard
- **Anonymous access** only records a timestamp — no IP address, no fingerprinting
- **Recipient identity verification** relies on the recipient clicking a link you send them; it proves they clicked the link, not that they decrypted the content
- **Duress mode UX**: the recipient sees the same UI for both real and decoy content. This is intentional — it prevents detection of the duress mechanism
- **The owner token is lost if the session ends** without saving the management URL. Save the management URL shown at creation time.

---

## Project Structure

```
SecureShare/
├── frontend/
│   └── src/
│       ├── App.tsx                  # Routing (/, /view/:id, /manage/:id)
│       ├── CreatePage.tsx           # Paste creation with all new features
│       ├── ViewPage.tsx             # Paste view with revoked/duress states
│       ├── ManagePage.tsx           # NEW: Owner management interface
│       ├── TransparencyView.tsx     # NEW: "What does the server see?" panel
│       ├── PasswordStrengthMeter.tsx # NEW: Live strength indicator
│       ├── crypto.ts                # All encryption (+ duress support)
│       ├── api.ts                   # API calls (+ new endpoints)
│       ├── passwordStrength.ts      # NEW: Strength analysis
│       ├── sensitivityAnalyzer.ts   # NEW: Local content scanner
│       ├── qrUtils.ts               # NEW: Client-side QR generation
│       ├── render.tsx               # Markdown/code rendering
│       ├── LanguageSelector.tsx     # Language picker
│       └── i18n/locales/            # 22 locale files
└── backend/
    └── server.js                    # Express + node:sqlite backend
```
