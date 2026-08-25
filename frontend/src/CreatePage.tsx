import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { encryptPaste, encryptWithDuress, type PasteFormat, type FileAttachment } from "./crypto";
import { createPaste } from "./api";
import { analyzeSensitivity, type SensitivityLevel } from "./sensitivityAnalyzer";
import { generateQRDataUrl } from "./qrUtils";
import PasswordStrengthMeter from "./PasswordStrengthMeter";
import TransparencyView, { type ServerPayload } from "./TransparencyView";

type SensitivityMode = "normal" | "sensitive" | "very_sensitive";

const TTL_OPTIONS = (t: (k: string) => string, mode: SensitivityMode) => {
  const all = [
    { label: t("create.ttl.10min"), seconds: 600 },
    { label: t("create.ttl.1hour"), seconds: 3600 },
    { label: t("create.ttl.1day"), seconds: 86400 },
    { label: t("create.ttl.1week"), seconds: 604800 },
    { label: t("create.ttl.never"), seconds: 0 },
  ];
  // Sensitive mode: default to 1 day max suggestion (user can override)
  if (mode === "very_sensitive") return all.slice(0, 3); // max 1 day
  if (mode === "sensitive") return all.slice(0, 4); // max 1 week
  return all;
};

const FORMAT_OPTIONS = (t: (k: string) => string): { value: PasteFormat; label: string }[] => [
  { value: "plain", label: t("create.format.plain") },
  { value: "markdown", label: t("create.format.markdown") },
  { value: "source", label: t("create.format.source") },
];

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(type: string): string {
  if (type.startsWith("image/")) return "🖼️";
  if (type.startsWith("video/")) return "🎬";
  if (type.startsWith("audio/")) return "🎵";
  if (type.includes("pdf")) return "📄";
  if (type.includes("zip") || type.includes("tar") || type.includes("gzip")) return "🗜️";
  if (type.startsWith("text/")) return "📝";
  return "📎";
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { resolve((reader.result as string).split(",")[1]); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

interface CreatedPasteInfo {
  link: string;
  ownerToken: string;
  pasteId: string;
  serverPayload: ServerPayload;
  sensitivityMode: SensitivityMode;
  hasPassword: boolean;
  burnAfterRead: boolean;
  allowDiscussion: boolean;
}

export default function CreatePage() {
  const { t } = useTranslation();

  // Content
  const [text, setText] = useState("");
  const [format, setFormat] = useState<PasteFormat>("plain");

  // Mode & protection
  const [mode, setMode] = useState<SensitivityMode>("normal");
  const [burnAfterRead, setBurnAfterRead] = useState(false);
  const [allowDiscussion, setAllowDiscussion] = useState(false);
  const [ttl, setTtl] = useState(3600);
  const [password, setPassword] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [duressPassword, setDuressPassword] = useState("");
  const [decoyMessage, setDecoyMessage] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");

  // File
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Analysis
  const [analysisResult, setAnalysisResult] = useState<ReturnType<typeof analyzeSensitivity> | null>(null);
  const [analysisRunning, setAnalysisRunning] = useState(false);

  // UI state
  const [createdPaste, setCreatedPaste] = useState<CreatedPasteInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showWarning, setShowWarning] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [manageLinkCopied, setManageLinkCopied] = useState(false);

  // When mode changes, auto-enable password for sensitive modes
  function handleModeChange(newMode: SensitivityMode) {
    setMode(newMode);
    if (newMode === "sensitive" || newMode === "very_sensitive") {
      setUsePassword(true);
      setBurnAfterRead(false);
      setAllowDiscussion(false);
      // Sensitive: tighten TTL
      if (newMode === "very_sensitive" && ttl > 86400) setTtl(86400);
      if (newMode === "sensitive" && ttl > 604800) setTtl(604800);
    }
  }

  const applyFile = useCallback((file: File) => {
    if (file.size > MAX_FILE_BYTES) {
      setError(t("create.error.filesize", { size: formatBytes(MAX_FILE_BYTES) }));
      return;
    }
    setError(null);
    setAttachedFile(file);
  }, [t]);

  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); }, []);
  const onDragLeave = useCallback(() => setIsDragging(false), []);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) applyFile(file);
  }, [applyFile]);
  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) applyFile(file);
    e.target.value = "";
  }, [applyFile]);

  function runAnalysis() {
    if (!text.trim()) return;
    setAnalysisRunning(true);
    // Small timeout so the UI visually responds
    setTimeout(() => {
      const result = analyzeSensitivity(text);
      setAnalysisResult(result);
      setAnalysisRunning(false);
    }, 200);
  }

  function applySuggestion(level: SensitivityLevel) {
    handleModeChange(level);
    setAnalysisResult(null);
  }

  async function doCreate() {
    setShowWarning(false);
    const hasText = text.trim().length > 0;
    const hasFile = !!attachedFile;
    if (!hasText && !hasFile) return;
    if (usePassword && !password) { setError(t("create.error.password")); return; }
    if (mode === "very_sensitive" && !password) { setError(t("create.error.password")); return; }

    setLoading(true); setError(null);
    try {
      let fileAttachment: FileAttachment | undefined;
      if (attachedFile) {
        const data = await readFileAsBase64(attachedFile);
        fileAttachment = { name: attachedFile.name, type: attachedFile.type || "application/octet-stream", data, size: attachedFile.size };
      }

      const payload = { content: text, format, file: fileAttachment };
      let cryptoResult: {
        ciphertext: string; iv: string; salt: string; keyB64: string; hasPassword: boolean;
        decoyCiphertext?: string; decoyIv?: string; decoySalt?: string;
      };

      if (mode === "very_sensitive" && password && duressPassword) {
        const decoyPayload = {
          content: decoyMessage || "Nothing sensitive here.",
          format: "plain" as PasteFormat,
        };
        const r = await encryptWithDuress(payload, decoyPayload, password, duressPassword);
        cryptoResult = { ...r, hasPassword: true };
      } else {
        cryptoResult = await encryptPaste(payload, usePassword ? password : null);
      }

      const res = await createPaste({
        ciphertext: cryptoResult.ciphertext,
        iv: cryptoResult.iv,
        salt: cryptoResult.salt,
        hasPassword: cryptoResult.hasPassword,
        burnAfterRead,
        ttlSeconds: ttl > 0 ? ttl : null,
        allowDiscussion: burnAfterRead ? false : allowDiscussion,
        sensitivityMode: mode,
        decoyCiphertext: cryptoResult.decoyCiphertext,
        decoyIv: cryptoResult.decoyIv,
        decoySalt: cryptoResult.decoySalt,
        recipientEmail: recipientEmail || undefined,
      });

      const link = `${window.location.origin}/view/${res.id}#${cryptoResult.keyB64}`;

      // Save owner token in sessionStorage for management
      try {
        sessionStorage.setItem(`owner_token_${res.id}`, res.ownerToken);
      } catch { /* storage blocked */ }

      const serverPayload: ServerPayload = {
        id: res.id,
        ciphertext: cryptoResult.ciphertext,
        iv: cryptoResult.iv,
        salt: cryptoResult.salt,
        sensitivityMode: mode,
        hasPassword: cryptoResult.hasPassword,
        hasDecoy: !!(cryptoResult.decoyCiphertext),
        expiresAt: res.expiresAt,
        revoked: false,
      };

      setCreatedPaste({
        link,
        ownerToken: res.ownerToken,
        pasteId: res.id,
        serverPayload,
        sensitivityMode: mode,
        hasPassword: cryptoResult.hasPassword,
        burnAfterRead,
        allowDiscussion: res.allowDiscussion,
      });
    } catch {
      setError(t("create.error.generic"));
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    if (mode === "sensitive" || mode === "very_sensitive") {
      setShowWarning(true);
      return;
    }
    await doCreate();
  }

  async function generateQR() {
    if (!createdPaste || qrLoading) return;
    setQrLoading(true);
    try {
      const url = await generateQRDataUrl(createdPaste.link);
      setQrDataUrl(url);
    } catch {
      setError("QR generation failed");
    } finally {
      setQrLoading(false);
    }
  }

  function reset() {
    setText(""); setCreatedPaste(null); setCopied(false);
    setPassword(""); setDuressPassword(""); setDecoyMessage("");
    setUsePassword(false); setAllowDiscussion(false); setAttachedFile(null);
    setMode("normal"); setAnalysisResult(null); setQrDataUrl(null);
    setRecipientEmail("");
  }

  const canSubmit = (text.trim().length > 0 || !!attachedFile) && !loading;
  const ttlOptions = TTL_OPTIONS(t, mode);
  const formatOptions = FORMAT_OPTIONS(t);

  // ── Warning modal ──────────────────────────────────────────────────────────
  if (showWarning) {
    return (
      <div className="card">
        <div className="mode-warning">
          <div className="mode-warning-icon">{mode === "very_sensitive" ? "🔐" : "⚠️"}</div>
          <h2 className="mode-warning-title">
            {mode === "very_sensitive" ? "Very Sensitive Mode" : "Sensitive Mode"}
          </h2>
          <p className="mode-warning-body">
            {mode === "very_sensitive"
              ? "You are about to create a highly sensitive share with duress password support. The server will receive two encrypted envelopes and cannot determine which is the real secret."
              : "You are about to create a sensitive share. A strong password is required. The server never sees the plaintext."}
          </p>
          <ul className="mode-warning-list">
            {mode === "very_sensitive" && (
              <>
                <li>✓ Real password reveals the actual secret</li>
                <li>✓ Duress password reveals the decoy message (silently)</li>
                <li>✓ Server cannot distinguish which is which</li>
              </>
            )}
            <li>✓ Plaintext never sent to server</li>
            <li>✓ Key never sent to server</li>
            {mode === "sensitive" && <li>✓ Password required to decrypt</li>}
          </ul>
          <div className="mode-warning-actions">
            <button onClick={doCreate} disabled={loading}>
              {loading ? t("create.encrypting") : "Confirm & Encrypt"}
            </button>
            <button className="secondary" onClick={() => setShowWarning(false)}>Go back</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Success screen ─────────────────────────────────────────────────────────
  if (createdPaste) {
    const { link, pasteId, ownerToken, serverPayload, sensitivityMode, hasPassword, burnAfterRead: bar, allowDiscussion: disc } = createdPaste;
    const manageUrl = `/manage/${pasteId}?token=${encodeURIComponent(ownerToken)}`;
    const mailtoLink = `mailto:${recipientEmail || ""}?subject=${encodeURIComponent("Secure share for you")}&body=${encodeURIComponent(`Here is your encrypted secure share:\n\n${link}\n\nThis link contains the decryption key. ${hasPassword ? "I will share the password with you separately." : ""}\n\nGenerated by SecureShare — zero-knowledge encrypted sharing.`)}`;

    return (
      <div className="card">
        <div className="success-header">
          <span className="success-icon">🔒</span>
          <div>
            <h2 style={{ margin: 0 }}>{t("success.title")}</h2>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              {t("success.subtitle", { suffix: hasPassword ? t("success.suffix_password") : "" })}
            </p>
          </div>
        </div>

        {/* Mode badge */}
        <div className={`mode-badge mode-badge--${sensitivityMode}`}>
          {sensitivityMode === "very_sensitive" && "🔐 Very Sensitive"}
          {sensitivityMode === "sensitive" && "⚠️ Sensitive"}
          {sensitivityMode === "normal" && "📄 Standard"}
        </div>

        {/* Link box */}
        <div className="link-box">
          <input id="share-link-input" readOnly value={link} onFocus={(e) => e.target.select()} />
          <button id="copy-link-btn" onClick={() => { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
            {copied ? t("success.copied") : t("success.copy")}
          </button>
        </div>

        {/* Sharing options */}
        <div className="share-actions">
          <button
            id="show-qr-btn"
            className="share-btn"
            onClick={generateQR}
            disabled={qrLoading}
            type="button"
          >
            {qrLoading ? "Generating…" : "📱 QR Code"}
          </button>
          <a
            id="email-share-link"
            className="share-btn share-btn--link"
            href={mailtoLink}
            rel="noopener noreferrer"
          >
            ✉️ Share via Email
          </a>
          <a
            id="manage-link"
            className="share-btn share-btn--manage"
            href={manageUrl}
          >
            ⚙️ Manage / Revoke
          </a>
        </div>

        {/* QR Code */}
        {qrDataUrl && (
          <div className="qr-container">
            <p className="qr-note">QR code encodes the full link including the decryption key. Treat it like the link itself.</p>
            <img src={qrDataUrl} alt="QR code for secure share link" className="qr-image" />
            <a href={qrDataUrl} download={`secureshare-${pasteId}.png`} className="share-btn share-btn--link">
              ⬇ Download QR
            </a>
          </div>
        )}

        {/* Warnings */}
        {hasPassword && <p className="warn">{t("success.warn_password")}</p>}
        {bar && <p className="warn">{t("success.warn_burn")}</p>}
        {disc && !bar && <p className="info">{t("success.info_discussion")}</p>}
        {sensitivityMode === "very_sensitive" && (
          <p className="info">🔐 Duress mode active — two passwords set, server cannot distinguish them.</p>
        )}

        {/* Transparency view */}
        <TransparencyView payload={serverPayload} />

        {/* Management link note */}
        <div className="manage-note">
          <span>⚙️ Save your management link to revoke access or track views:</span>
          <div className="link-box" style={{ marginTop: 8 }}>
            <input readOnly value={`${window.location.origin}${manageUrl}`} onFocus={(e) => e.target.select()} />
            <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}${manageUrl}`); setManageLinkCopied(true); setTimeout(() => setManageLinkCopied(false), 1500); }} type="button">
              {manageLinkCopied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>

        <button className="secondary" onClick={reset}>{t("success.create_another")}</button>
      </div>
    );
  }

  // ── Main creation form ─────────────────────────────────────────────────────
  return (
    <div className="card">
      <h2>{t("create.title")}</h2>
      <p className="muted">{t("create.subtitle")}</p>

      {/* Sensitivity Mode Selector */}
      <div className="sensitivity-mode-selector" role="group" aria-label="Sensitivity mode">
        <div className="sensitivity-mode-label">Protection level:</div>
        <div className="sensitivity-mode-tabs">
          {(["normal", "sensitive", "very_sensitive"] as SensitivityMode[]).map((m) => (
            <button
              key={m}
              type="button"
              id={`mode-btn-${m}`}
              className={`sensitivity-tab ${mode === m ? "active" : ""} sensitivity-tab--${m}`}
              onClick={() => handleModeChange(m)}
            >
              {m === "normal" && "📄 Non-sensitive"}
              {m === "sensitive" && "⚠️ Sensitive"}
              {m === "very_sensitive" && "🔐 Very Sensitive"}
            </button>
          ))}
        </div>
        <div className="sensitivity-mode-desc">
          {mode === "normal" && "Standard sharing. No special requirements."}
          {mode === "sensitive" && "Requires a strong password. Recommended for private information."}
          {mode === "very_sensitive" && "Two-password duress mode. Real password reveals secret; decoy password reveals a safe decoy message. Server cannot tell which is which."}
        </div>
      </div>

      {/* Format tabs */}
      <div className="format-tabs">
        {formatOptions.map((opt) => (
          <button key={opt.value} type="button"
            className={`format-tab ${format === opt.value ? "active" : ""}`}
            onClick={() => setFormat(opt.value)}>
            {opt.label}
          </button>
        ))}
      </div>

      {/* Text area */}
      <textarea
        id="paste-textarea"
        placeholder={format === "markdown" ? t("create.placeholder.markdown") : format === "source" ? t("create.placeholder.source") : t("create.placeholder.plain")}
        value={text} onChange={(e) => setText(e.target.value)}
        rows={10} spellCheck={format === "plain"}
        className={format !== "plain" ? "mono" : ""}
      />

      {/* Local content sensitivity analyzer */}
      <div className="analyzer-row">
        <button
          id="analyze-btn"
          type="button"
          className="analyzer-trigger"
          onClick={runAnalysis}
          disabled={analysisRunning || !text.trim()}
          title="Analyzes content locally in your browser — never sends plaintext to any server"
        >
          {analysisRunning ? "Analyzing…" : "🔍 Analyze content sensitivity"}
        </button>
        <span className="analyzer-badge-label">Local rule-based analyzer · no cloud AI</span>
      </div>

      {analysisResult && (
        <div className={`analyzer-result ${analysisResult.suggestedLevel}`}>
          {analysisResult.detections.length === 0 ? (
            <span className="analyzer-ok">✓ No sensitive patterns detected</span>
          ) : (
            <>
              <div className="analyzer-findings">
                <strong>Possible sensitive content detected:</strong>
                <ul>
                  {analysisResult.detections.map((d, i) => (
                    <li key={i}>
                      <span className={`analyzer-level-dot level-${d.level}`} />
                      {d.category} — {d.description}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="analyzer-suggestion">
                Suggested protection:{" "}
                <strong>
                  {analysisResult.suggestedLevel === "very_sensitive" ? "🔐 Very Sensitive" : "⚠️ Sensitive"}
                </strong>
                <button
                  type="button"
                  className="analyzer-apply-btn"
                  onClick={() => applySuggestion(analysisResult.suggestedLevel)}
                >
                  Apply suggestion
                </button>
              </div>
            </>
          )}
          <button type="button" className="analyzer-dismiss" onClick={() => setAnalysisResult(null)}>✕ Dismiss</button>
        </div>
      )}

      {/* File dropzone */}
      <div
        className={`dropzone ${isDragging ? "dragging" : ""} ${attachedFile ? "has-file" : ""}`}
        onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
        onClick={() => !attachedFile && fileInputRef.current?.click()}
        role="button" tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && !attachedFile && fileInputRef.current?.click()}
        aria-label={t("create.dropzone.text")}
      >
        <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={onFileChange} />
        {attachedFile ? (
          <div className="dropzone-file-info">
            <span className="dropzone-file-icon">{fileIcon(attachedFile.type)}</span>
            <div className="dropzone-file-details">
              <span className="dropzone-file-name">{attachedFile.name}</span>
              <span className="dropzone-file-size">{formatBytes(attachedFile.size)}</span>
            </div>
            <button className="dropzone-remove" onClick={(e) => { e.stopPropagation(); setAttachedFile(null); }} title={t("create.dropzone.remove")} type="button">✕</button>
          </div>
        ) : (
          <div className="dropzone-prompt">
            <span className="dropzone-icon">📎</span>
            <span className="dropzone-text">{isDragging ? t("create.dropzone.dragging") : t("create.dropzone.text")}</span>
            <span className="dropzone-subtext">{t("create.dropzone.subtext", { size: formatBytes(MAX_FILE_BYTES) })}</span>
          </div>
        )}
      </div>

      {/* Options row */}
      <div className="options-row">
        <label>
          {t("create.expires")}
          <select id="ttl-select" value={ttl} onChange={(e) => setTtl(Number(e.target.value))}>
            {ttlOptions.map((o) => <option key={o.seconds} value={o.seconds}>{o.label}</option>)}
          </select>
        </label>
        <label className="checkbox-label">
          <input id="burn-checkbox" type="checkbox" checked={burnAfterRead} onChange={(e) => { setBurnAfterRead(e.target.checked); if (e.target.checked) setAllowDiscussion(false); }} />
          {t("create.burn")}
        </label>

        {/* Password section */}
        <div className="password-row">
          <label className="checkbox-label">
            <input
              id="password-checkbox"
              type="checkbox"
              checked={usePassword || mode === "sensitive" || mode === "very_sensitive"}
              disabled={mode === "sensitive" || mode === "very_sensitive"}
              onChange={(e) => setUsePassword(e.target.checked)}
            />
            {t("create.password")}
          </label>
          {(usePassword || mode === "sensitive" || mode === "very_sensitive") && (
            <div className="password-field-group">
              <input
                id="password-input"
                type="password"
                className="password-input"
                placeholder={mode === "very_sensitive" ? "Real password" : t("create.password_placeholder")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <PasswordStrengthMeter password={password} />
            </div>
          )}
        </div>

        <label className={`checkbox-label discussion-toggle ${burnAfterRead ? "disabled" : ""}`} title={burnAfterRead ? t("create.discussion_disabled") : ""}>
          <input id="discussion-checkbox" type="checkbox" checked={allowDiscussion} disabled={burnAfterRead} onChange={(e) => setAllowDiscussion(e.target.checked)} />
          {t("create.discussion")}
        </label>
      </div>

      {/* Very Sensitive: duress password + decoy message */}
      {mode === "very_sensitive" && (
        <div className="duress-section">
          <div className="duress-header">
            <span className="duress-icon">🎭</span>
            <div>
              <div className="duress-title">Duress / Decoy Password</div>
              <div className="duress-subtitle">
                If someone forces you to reveal the password, give them the duress password instead. They will see the decoy message, not your real secret. The server cannot tell the difference.
              </div>
            </div>
          </div>
          <div className="duress-fields">
            <div className="password-field-group">
              <label className="duress-field-label">Duress password (shown to coercer)</label>
              <input
                id="duress-password-input"
                type="password"
                className="password-input"
                placeholder="Duress password"
                value={duressPassword}
                onChange={(e) => setDuressPassword(e.target.value)}
              />
              <PasswordStrengthMeter password={duressPassword} />
            </div>
            <div className="password-field-group">
              <label className="duress-field-label">Decoy message (shown when duress password is used)</label>
              <textarea
                id="decoy-message-input"
                className="decoy-textarea"
                placeholder="Nothing sensitive here. (Leave blank for default)"
                value={decoyMessage}
                onChange={(e) => setDecoyMessage(e.target.value)}
                rows={3}
              />
            </div>
          </div>
        </div>
      )}

      {/* Optional recipient email */}
      <div className="recipient-row">
        <label className="recipient-label">
          📧 Recipient email <span className="muted">(optional — for access notification)</span>
        </label>
        <input
          id="recipient-email-input"
          type="email"
          className="password-input recipient-input"
          placeholder="recipient@example.com"
          value={recipientEmail}
          onChange={(e) => setRecipientEmail(e.target.value)}
        />
      </div>

      {error && <p className="error">{error}</p>}
      <button id="create-paste-btn" disabled={!canSubmit} onClick={handleSubmit}>
        {loading ? t("create.encrypting") : t("create.submit")}
      </button>
    </div>
  );
}
