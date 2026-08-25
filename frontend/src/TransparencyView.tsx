// TransparencyView.tsx — "What does the server see?" demonstration panel.
// Shows the ACTUAL encrypted payload that was sent/stored on the server.
// Uses real ciphertext values, not fake/demo data.
// This is a core zero-knowledge proof-of-concept feature.

import { useState } from "react";

export interface ServerPayload {
  id: string;
  ciphertext: string;
  iv: string;
  salt: string;
  sensitivityMode: string;
  hasPassword: boolean;
  hasDecoy: boolean;
  expiresAt: number | null;
  revoked: boolean;
}

interface Props {
  payload: ServerPayload;
}

function truncate(s: string, n = 48): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}

export default function TransparencyView({ payload }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  function copyField(label: string, value: string) {
    navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="transparency-panel">
      <button
        className="transparency-toggle"
        onClick={() => setOpen((v) => !v)}
        title="See exactly what the server stores — no plaintext, ever"
        type="button"
      >
        🔍 What does the server see?
        <span className="transparency-caret">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="transparency-body">
          <p className="transparency-intro">
            Below is the <strong>exact data the server stores</strong>. Your original text, the
            decryption key, and your password never appear here.
          </p>

          <div className="transparency-section">
            <div className="transparency-section-title">✅ Server DOES store</div>
            <table className="transparency-table">
              <tbody>
                <tr>
                  <td className="t-key">Paste ID</td>
                  <td className="t-value mono">{payload.id}</td>
                  <td />
                </tr>
                <tr>
                  <td className="t-key">Ciphertext</td>
                  <td className="t-value mono">{truncate(payload.ciphertext)}</td>
                  <td>
                    <button
                      className="t-copy-btn"
                      onClick={() => copyField("ciphertext", payload.ciphertext)}
                      type="button"
                    >
                      {copied === "ciphertext" ? "✓" : "copy"}
                    </button>
                  </td>
                </tr>
                <tr>
                  <td className="t-key">IV (nonce)</td>
                  <td className="t-value mono">{truncate(payload.iv, 32)}</td>
                  <td />
                </tr>
                <tr>
                  <td className="t-key">Salt</td>
                  <td className="t-value mono">{truncate(payload.salt, 32)}</td>
                  <td />
                </tr>
                <tr>
                  <td className="t-key">Has password</td>
                  <td className="t-value">{payload.hasPassword ? "Yes (flag only)" : "No"}</td>
                  <td />
                </tr>
                <tr>
                  <td className="t-key">Has decoy envelope</td>
                  <td className="t-value">{payload.hasDecoy ? "Yes (two ciphertexts, indistinguishable)" : "No"}</td>
                  <td />
                </tr>
                <tr>
                  <td className="t-key">Sensitivity mode</td>
                  <td className="t-value">{payload.sensitivityMode}</td>
                  <td />
                </tr>
                <tr>
                  <td className="t-key">Expires at</td>
                  <td className="t-value">
                    {payload.expiresAt
                      ? new Date(payload.expiresAt).toLocaleString()
                      : "Never"}
                  </td>
                  <td />
                </tr>
                <tr>
                  <td className="t-key">Revoked</td>
                  <td className="t-value">{payload.revoked ? "🔴 Yes" : "🟢 No"}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>

          <div className="transparency-section transparency-section--deny">
            <div className="transparency-section-title transparency-deny-title">❌ Server NEVER sees</div>
            <ul className="transparency-deny-list">
              <li>Your original plaintext content</li>
              <li>The decryption key (it lives only in the URL <code>#fragment</code> — browsers never send that to servers)</li>
              <li>Your password (never transmitted; used only locally for key derivation)</li>
              <li>Decrypted file contents</li>
              <li>Decrypted comments</li>
              {payload.hasDecoy && (
                <li>Which ciphertext is "real" and which is the duress decoy</li>
              )}
            </ul>
          </div>

          <div className="transparency-note">
            <span className="transparency-note-icon">🔒</span>
            The ciphertext above is AES-256-GCM encrypted. Without the URL fragment key{payload.hasPassword ? " and your password" : ""}, it is computationally infeasible to decrypt.
          </div>
        </div>
      )}
    </div>
  );
}
