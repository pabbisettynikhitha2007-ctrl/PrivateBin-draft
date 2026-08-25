// ManagePage.tsx — owner management interface.
// Route: /manage/:id?token=OWNER_TOKEN
// Lets the paste creator:
//   - see access log (who/when accessed, verified emails vs anonymous)
//   - emergency revoke the paste
//   - set up recipient identity verification (generates a verify link via mailto:)
//   - view "what does the server see?" transparency panel

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { fetchPasteStatus, revokePaste, requestRecipientVerification, type PasteStatus, type AccessEntry } from "./api";
import TransparencyView, { type ServerPayload } from "./TransparencyView";

function formatTime(ts: number) {
  return new Date(ts).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function ManagePage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const ownerToken = searchParams.get("token") ?? (id ? (sessionStorage.getItem(`owner_token_${id}`) ?? "") : "");

  const [status, setStatus] = useState<PasteStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  // Recipient verification
  const [recipientEmail, setRecipientEmail] = useState("");
  const [verifyResult, setVerifyResult] = useState<{ verifyUrl: string } | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyCopied, setVerifyCopied] = useState(false);

  useEffect(() => {
    if (!id || !ownerToken) {
      setError("Missing paste ID or owner token.");
      setLoading(false);
      return;
    }
    loadStatus();
  }, [id, ownerToken]);

  async function loadStatus() {
    setLoading(true);
    try {
      const s = await fetchPasteStatus(id!, ownerToken);
      setStatus(s);
      if (s.revoked) setRevoked(true);
    } catch (e: unknown) {
      const msg = (e as Error)?.message;
      if (msg === "unauthorized") setError("Invalid owner token — you don't have permission to manage this paste.");
      else setError("Could not load paste status.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRevoke() {
    if (!id) return;
    setRevoking(true);
    try {
      await revokePaste(id, ownerToken);
      setRevoked(true);
      setConfirmRevoke(false);
      await loadStatus();
    } catch {
      setError("Revocation failed. Please try again.");
    } finally {
      setRevoking(false);
    }
  }

  async function handleVerifyRequest() {
    if (!id || !recipientEmail.includes("@")) return;
    setVerifyLoading(true);
    setVerifyError(null);
    try {
      const result = await requestRecipientVerification(id, recipientEmail);
      setVerifyResult(result);
    } catch {
      setVerifyError("Failed to generate verification link. Try again.");
    } finally {
      setVerifyLoading(false);
    }
  }

  // Build a fake but truthful ServerPayload for the transparency view
  const transparencyPayload: ServerPayload | null = status
    ? {
        id: status.id,
        ciphertext: "[ stored server-side — opaque ciphertext only ]",
        iv: "[ IV stored server-side ]",
        salt: "[ Salt stored server-side ]",
        sensitivityMode: status.sensitivityMode,
        hasPassword: false, // we don't know from status endpoint (correct — server doesn't either)
        hasDecoy: false,
        expiresAt: status.expiresAt,
        revoked: status.revoked,
      }
    : null;

  if (loading) return <div className="card"><p className="muted">Loading management panel…</p></div>;
  if (error) return <div className="card"><h2>Management Error</h2><p className="muted">{error}</p></div>;
  if (!status) return null;

  return (
    <div className="manage-page">
      {/* Header */}
      <div className="card manage-header">
        <div className="manage-header-top">
          <div>
            <h2 style={{ margin: 0 }}>⚙️ Paste Management</h2>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              ID: <code>{status.id}</code> · Mode: <strong>{status.sensitivityMode.replace("_", " ")}</strong>
            </p>
          </div>
          <div className={`manage-status-badge ${revoked ? "revoked" : "active"}`}>
            {revoked ? "🔴 Revoked" : "🟢 Active"}
          </div>
        </div>

        {status.expiresAt && (
          <p className="muted" style={{ marginTop: 8 }}>
            Expires: {formatTime(status.expiresAt)}
          </p>
        )}
      </div>

      {/* Access Log */}
      <div className="card manage-section">
        <h3 className="manage-section-title">📊 Access Log</h3>
        <p className="muted">
          {status.accessCount === 0
            ? "This share has not been accessed yet."
            : `Accessed ${status.accessCount} time${status.accessCount === 1 ? "" : "s"}.`}
        </p>

        {status.accesses.length > 0 && (
          <div className="access-log">
            {status.accesses.map((entry: AccessEntry) => (
              <div key={entry.id} className="access-log-entry">
                <div className="access-log-icon">
                  {entry.verified_email ? "✓" : "•"}
                </div>
                <div className="access-log-body">
                  <div className="access-log-time">{formatTime(entry.accessed_at)}</div>
                  {entry.verified_email ? (
                    <div className="access-log-identity verified">
                      ✓ Viewed by verified recipient: <strong>{entry.verified_email}</strong>
                      {entry.verified_at && (
                        <span className="access-log-verified-time"> (verified {formatTime(entry.verified_at)})</span>
                      )}
                    </div>
                  ) : (
                    <div className="access-log-identity anonymous">
                      Viewer identity unavailable
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recipient Identity Verification */}
      {!revoked && (
        <div className="card manage-section">
          <h3 className="manage-section-title">🪪 Request Identity Verification</h3>
          <p className="muted">
            Send a one-time verification link to the intended recipient. When they click it, their
            identity will appear in the access log above. No email is sent by the server — you copy
            the link yourself.
          </p>

          {!verifyResult ? (
            <div className="verify-request-form">
              <input
                id="verify-email-input"
                type="email"
                className="password-input recipient-input"
                placeholder="recipient@example.com"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                style={{ width: "100%", marginBottom: 10 }}
              />
              <button
                id="request-verify-btn"
                onClick={handleVerifyRequest}
                disabled={verifyLoading || !recipientEmail.includes("@")}
                type="button"
              >
                {verifyLoading ? "Generating…" : "Generate Verification Link"}
              </button>
              {verifyError && <p className="error">{verifyError}</p>}
            </div>
          ) : (
            <div className="verify-result">
              <p className="info">✓ Verification link generated. Copy it and send it to the recipient:</p>
              <div className="link-box">
                <input readOnly value={verifyResult.verifyUrl} onFocus={(e) => e.target.select()} />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(verifyResult.verifyUrl);
                    setVerifyCopied(true);
                    setTimeout(() => setVerifyCopied(false), 1500);
                  }}
                  type="button"
                >
                  {verifyCopied ? "Copied!" : "Copy"}
                </button>
              </div>
              <a
                href={`mailto:${recipientEmail}?subject=${encodeURIComponent("Please verify your identity")}&body=${encodeURIComponent(`Please click this link to verify that you accessed my secure share:\n\n${verifyResult.verifyUrl}`)}`}
                className="share-btn share-btn--link"
                style={{ display: "inline-block", marginTop: 8 }}
              >
                ✉️ Open in email client
              </a>
              <button className="secondary" style={{ display: "block", marginTop: 8 }} onClick={() => { setVerifyResult(null); setRecipientEmail(""); }}>
                Generate another
              </button>
            </div>
          )}
        </div>
      )}

      {/* Emergency Revoke */}
      <div className="card manage-section">
        <h3 className="manage-section-title">🚨 Emergency Revoke</h3>
        {revoked ? (
          <div className="revoke-done">
            <span className="revoke-done-icon">🔴</span>
            <div>
              <strong>Access has been permanently revoked.</strong>
              <p className="muted">
                Future access attempts will fail. Note: content already decrypted in a recipient's
                browser cannot be erased — revocation prevents <em>new</em> server-side retrievals.
              </p>
            </div>
          </div>
        ) : !confirmRevoke ? (
          <>
            <p className="muted">
              Immediately prevents further retrieval of this paste. This cannot be undone.
            </p>
            <button
              id="revoke-btn"
              className="revoke-btn"
              onClick={() => setConfirmRevoke(true)}
              type="button"
            >
              🔴 Emergency Revoke
            </button>
          </>
        ) : (
          <div className="revoke-confirm">
            <p className="warn">⚠️ Are you sure? This will permanently block all future access to this paste.</p>
            <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
              <button
                id="confirm-revoke-btn"
                className="revoke-btn"
                onClick={handleRevoke}
                disabled={revoking}
                type="button"
              >
                {revoking ? "Revoking…" : "Yes, revoke now"}
              </button>
              <button className="secondary" onClick={() => setConfirmRevoke(false)} type="button">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Transparency View */}
      {transparencyPayload && (
        <div className="card manage-section">
          <TransparencyView payload={transparencyPayload} />
        </div>
      )}

      {/* Refresh */}
      <div style={{ textAlign: "center", marginTop: 8 }}>
        <button className="secondary" onClick={loadStatus} type="button">↻ Refresh</button>
      </div>
    </div>
  );
}
