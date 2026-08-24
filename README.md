# 🔒 SecureShare

> **Zero-knowledge encrypted text & file sharing — the server never sees your data.**

SecureShare is a modern, privacy-first alternative to Pastebin / PrivateBin. Every paste, file, and comment is **encrypted entirely in your browser** using AES-256-GCM before it ever leaves your device. The server stores only opaque ciphertext — it literally cannot read what you share.

---

## ✨ Features

### 🔐 Zero-Knowledge Encryption
- All encryption and decryption happens **client-side** using the Web Crypto API
- The decryption key lives **only in the URL fragment (`#...`)** — browsers never send it to the server
- Optional **password protection** — combines the URL key + your password via PBKDF2 (250,000 iterations), so both are required to decrypt
- Server stores only: ciphertext, IV, salt, and metadata — **no plaintext, ever**

### 📝 Paste Creation
- Three format modes: **Plain Text**, **Markdown** (rendered), **Source Code** (syntax highlighted)
- Configurable **expiry**: 10 minutes · 1 hour · 1 day · 1 week · Never
- **Burn after reading** — paste is permanently deleted server-side after the first view
- Password protection toggle with inline password field
- One-click **copy link** on the success screen

### 💬 Open Discussion (optional, E2E encrypted)
- Paste creators can enable an optional **discussion thread** below their paste
- All comments (nickname + message) are **AES-256-GCM encrypted** using the same URL key before posting — the server never sees comment text
- **Auto-refreshes every 5 seconds** — no page reload needed to see new messages
- New comments trigger a **"↓ N new comments" nudge banner** while you're reading
- Color-coded **avatar initials** per commenter (deterministic, consistent colors)
- `Ctrl+Enter` to submit a comment
- Disabled automatically on burn-after-read pastes

### 📎 File Attachments (drag & drop, E2E encrypted)
- **Drag & drop** any file onto the create page, or click to browse
- File is read as Base64 in the browser, **bundled into the encrypted payload**, and uploaded as ciphertext — never visible to the server
- Smart **file type icons**: 🖼️ images · 📄 PDFs · 🗜️ archives · 🎬 video · 🎵 audio · 📝 text
- Max **10 MB** per file
- On the view page: a download card shows filename + size with a **⬇ Download** button that reconstructs the file from the decrypted payload using a Blob URL
- Text content is **optional** — file-only pastes are supported

### 🔁 Smart Session Caching
- After revealing a paste once, the decrypted content is cached in **`sessionStorage`**
- **Refreshing the page** skips the "Reveal paste" screen and shows the content immediately — no re-fetching, no re-decrypting
- Session storage is cleared automatically when the tab is closed

### 🌐 Internationalization — 22 Languages
A language selector (🌐) in the top-right corner switches the entire UI instantly:

| International | Indian Regional |
|---|---|
| 🇬🇧 English | 🇮🇳 Hindi (हिन्दी) |
| 🇪🇸 Spanish (Español) | 🇮🇳 Bengali (বাংলা) |
| 🇫🇷 French (Français) | 🇮🇳 Telugu (తెలుగు) |
| 🇩🇪 German (Deutsch) | 🇮🇳 Tamil (தமிழ்) |
| 🇵🇹 Portuguese (Português) | 🇮🇳 Marathi (मराठी) |
| 🇮🇹 Italian (Italiano) | 🇮🇳 Gujarati (ગુજરાતી) |
| 🇷🇺 Russian (Русский) | 🇮🇳 Kannada (ಕನ್ನಡ) |
| 🇸🇦 Arabic (العربية) — RTL | 🇮🇳 Malayalam (മലയാളം) |
| 🇨🇳 Chinese (中文) | 🇮🇳 Punjabi (ਪੰਜਾਬੀ) |
| 🇯🇵 Japanese (日本語) | 🇮🇳 Odia (ଓଡ଼ିଆ) |
| 🇰🇷 Korean (한국어) | 🇮🇳 Urdu (اردو) — RTL |

- Language preference is **saved in `localStorage`** across refreshes
- **Full RTL layout** for Arabic and Urdu (text direction, flex ordering, inputs)
- Powered by **i18next + react-i18next**

---

## 🏗️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19 + TypeScript + Vite |
| **Styling** | Vanilla CSS — dark mode, glassmorphism, micro-animations |
| **Encryption** | Web Crypto API (AES-256-GCM, PBKDF2) |
| **Rendering** | Marked (Markdown) + Highlight.js (code) |
| **i18n** | i18next + react-i18next |
| **Backend** | Node.js (Express) + built-in SQLite (`node:sqlite`) |
| **Deployment** | Docker + Docker Compose (nginx serving static frontend) |

---

## 🚀 Running Locally

### With Docker (recommended)
```bash
git clone https://github.com/your-username/secureshare
cd secureshare
docker compose up --build -d
```
- Frontend: http://localhost:5173
- Backend API: http://localhost:4000

### Without Docker
```bash
# Terminal 1 — Backend
cd backend
npm install
node server.js

# Terminal 2 — Frontend
cd frontend
npm install --legacy-peer-deps
npm run dev
```

---

## 🔑 Security Model

```
Browser                              Server
──────                               ──────
plaintext                            ❌ never sees plaintext
   │
   ▼
AES-256-GCM encrypt                  stores only:
(key = random 256-bit)  ──────────►  • ciphertext
                                     • IV
URL: /view/<id>#<key>                • salt
              ▲                      • metadata
              │
     key stays in fragment
     (never sent to server)
```

- Files are encrypted as Base64 inside the same payload — indistinguishable from text to the server
- Comments are encrypted per-field (nickname + body) using the paste's URL key
- Burn-after-read pastes are deleted server-side on first fetch — even the ciphertext is gone
- PBKDF2 password hashing means a leaked link without the password is useless

---

## 📁 Project Structure

```
├── backend/
│   ├── server.js          # Express API — dumb blob store
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── i18n/
│   │   │   ├── index.ts           # i18next setup
│   │   │   └── locales/           # 22 JSON translation files
│   │   ├── App.tsx                # Router + header
│   │   ├── CreatePage.tsx         # Paste creation UI
│   │   ├── ViewPage.tsx           # Paste view + discussion
│   │   ├── LanguageSelector.tsx   # 🌐 language picker
│   │   ├── crypto.ts              # All encryption logic
│   │   ├── api.ts                 # API client
│   │   ├── render.tsx             # Markdown/code renderer
│   │   └── App.css                # All styles
│   └── Dockerfile
├── docker-compose.yml
└── README.md
```

---

## 📄 License

ISC
