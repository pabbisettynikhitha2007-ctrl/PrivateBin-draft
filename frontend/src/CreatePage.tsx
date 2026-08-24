import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { encryptPaste, type PasteFormat, type FileAttachment } from "./crypto";
import { createPaste } from "./api";

const TTL_OPTIONS = (t: (k: string) => string) => [
  { label: t("create.ttl.10min"), seconds: 600 },
  { label: t("create.ttl.1hour"), seconds: 3600 },
  { label: t("create.ttl.1day"), seconds: 86400 },
  { label: t("create.ttl.1week"), seconds: 604800 },
  { label: t("create.ttl.never"), seconds: 0 },
];

const FORMAT_OPTIONS = (t: (k: string) => string): { value: PasteFormat; label: string }[] => [
  { value: "plain",    label: t("create.format.plain")    },
  { value: "markdown", label: t("create.format.markdown") },
  { value: "source",   label: t("create.format.source")   },
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
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function CreatePage() {
  const { t } = useTranslation();

  const [text, setText] = useState("");
  const [format, setFormat] = useState<PasteFormat>("plain");
  const [burnAfterRead, setBurnAfterRead] = useState(false);
  const [allowDiscussion, setAllowDiscussion] = useState(false);
  const [ttl, setTtl] = useState(3600);
  const [password, setPassword] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function applyFile(file: File) {
    if (file.size > MAX_FILE_BYTES) {
      setError(t("create.error.filesize", { size: formatBytes(MAX_FILE_BYTES) }));
      return;
    }
    setError(null);
    setAttachedFile(file);
  }

  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); }, []);
  const onDragLeave = useCallback(() => setIsDragging(false), []);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) applyFile(file);
  }, []);
  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) applyFile(file);
    e.target.value = "";
  }, []);

  async function handleSubmit() {
    const hasText = text.trim().length > 0;
    const hasFile = !!attachedFile;
    if (!hasText && !hasFile) return;
    if (usePassword && !password) { setError(t("create.error.password")); return; }
    setLoading(true); setError(null);
    try {
      let fileAttachment: FileAttachment | undefined;
      if (attachedFile) {
        const data = await readFileAsBase64(attachedFile);
        fileAttachment = { name: attachedFile.name, type: attachedFile.type || "application/octet-stream", data, size: attachedFile.size };
      }
      const { ciphertext, iv, salt, keyB64, hasPassword } = await encryptPaste(
        { content: text, format, file: fileAttachment },
        usePassword ? password : null
      );
      const { id } = await createPaste({ ciphertext, iv, salt, hasPassword, burnAfterRead, ttlSeconds: ttl > 0 ? ttl : null, allowDiscussion: burnAfterRead ? false : allowDiscussion });
      setLink(`${window.location.origin}/view/${id}#${keyB64}`);
    } catch {
      setError(t("create.error.generic"));
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setText(""); setLink(null); setCopied(false);
    setPassword(""); setUsePassword(false);
    setAllowDiscussion(false); setAttachedFile(null);
  }

  const canSubmit = (text.trim().length > 0 || !!attachedFile) && !loading;

  if (link) {
    return (
      <div className="card">
        <h2>{t("success.title")}</h2>
        <p className="muted">{t("success.subtitle", { suffix: usePassword ? t("success.suffix_password") : "" })}</p>
        <div className="link-box">
          <input readOnly value={link} onFocus={(e) => e.target.select()} />
          <button onClick={() => { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
            {copied ? t("success.copied") : t("success.copy")}
          </button>
        </div>
        {usePassword && <p className="warn">{t("success.warn_password")}</p>}
        {burnAfterRead && <p className="warn">{t("success.warn_burn")}</p>}
        {allowDiscussion && !burnAfterRead && <p className="info">{t("success.info_discussion")}</p>}
        <button className="secondary" onClick={reset}>{t("success.create_another")}</button>
      </div>
    );
  }

  const ttlOptions = TTL_OPTIONS(t);
  const formatOptions = FORMAT_OPTIONS(t);

  return (
    <div className="card">
      <h2>{t("create.title")}</h2>
      <p className="muted">{t("create.subtitle")}</p>

      <div className="format-tabs">
        {formatOptions.map((opt) => (
          <button key={opt.value} type="button"
            className={`format-tab ${format === opt.value ? "active" : ""}`}
            onClick={() => setFormat(opt.value)}>
            {opt.label}
          </button>
        ))}
      </div>

      <textarea
        placeholder={format === "markdown" ? t("create.placeholder.markdown") : format === "source" ? t("create.placeholder.source") : t("create.placeholder.plain")}
        value={text} onChange={(e) => setText(e.target.value)}
        rows={10} spellCheck={format === "plain"}
        className={format !== "plain" ? "mono" : ""}
      />

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

      <div className="options-row">
        <label>
          {t("create.expires")}
          <select value={ttl} onChange={(e) => setTtl(Number(e.target.value))}>
            {ttlOptions.map((o) => <option key={o.seconds} value={o.seconds}>{o.label}</option>)}
          </select>
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={burnAfterRead} onChange={(e) => { setBurnAfterRead(e.target.checked); if (e.target.checked) setAllowDiscussion(false); }} />
          {t("create.burn")}
        </label>
        <div className="password-row">
          <label className="checkbox-label">
            <input type="checkbox" checked={usePassword} onChange={(e) => setUsePassword(e.target.checked)} />
            {t("create.password")}
          </label>
          {usePassword && (
            <input type="password" className="password-input" placeholder={t("create.password_placeholder")} value={password} onChange={(e) => setPassword(e.target.value)} />
          )}
        </div>
        <label className={`checkbox-label discussion-toggle ${burnAfterRead ? "disabled" : ""}`} title={burnAfterRead ? t("create.discussion_disabled") : ""}>
          <input type="checkbox" checked={allowDiscussion} disabled={burnAfterRead} onChange={(e) => setAllowDiscussion(e.target.checked)} />
          {t("create.discussion")}
        </label>
      </div>

      {error && <p className="error">{error}</p>}
      <button disabled={!canSubmit} onClick={handleSubmit}>
        {loading ? t("create.encrypting") : t("create.submit")}
      </button>
    </div>
  );
}
