import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { fetchPaste, fetchComments, postComment, type RawComment } from "./api";
import { decryptPaste, encryptComment, decryptComment, type PastePayload } from "./crypto";
import { renderPayload } from "./render";

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

type FetchedData = {
  ciphertext: string; iv: string; salt: string;
  hasPassword: boolean; burnAfterRead: boolean; allowDiscussion: boolean;
};

type State =
  | { status: "confirm" }
  | { status: "fetching" }
  | { status: "password"; data: FetchedData; attemptError: boolean }
  | { status: "revealed"; payload: PastePayload; burnAfterRead: boolean; allowDiscussion: boolean }
  | { status: "error"; message: string };

interface DecryptedComment {
  id: string; nickname: string; text: string; createdAt: number;
}

const POLL_INTERVAL_MS = 5000;

function cacheReveal(pasteId: string, payload: PastePayload, meta: { burnAfterRead: boolean; allowDiscussion: boolean }) {
  try { sessionStorage.setItem(`paste_revealed_${pasteId}`, JSON.stringify({ payload, ...meta })); } catch { }
}

function loadCachedReveal(pasteId: string): { payload: PastePayload; burnAfterRead: boolean; allowDiscussion: boolean } | null {
  try { const raw = sessionStorage.getItem(`paste_revealed_${pasteId}`); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export default function ViewPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();

  const [state, setState] = useState<State>(() => {
    if (id) {
      const cached = loadCachedReveal(id);
      if (cached) return { status: "revealed", payload: cached.payload, burnAfterRead: cached.burnAfterRead, allowDiscussion: cached.allowDiscussion };
    }
    return { status: "confirm" };
  });

  const [passwordInput, setPasswordInput] = useState("");
  const [pending, setPending] = useState(false);

  const [comments, setComments] = useState<DecryptedComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [nickname, setNickname] = useState("");
  const [commentText, setCommentText] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [newCommentCount, setNewCommentCount] = useState(0);

  const commentListRef = useRef<HTMLDivElement>(null);
  const knownCommentIds = useRef<Set<string>>(new Set());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const keyB64 = window.location.hash.slice(1);

  useEffect(() => {
    if (!id || !keyB64) setState({ status: "error", message: t("view.error.no_key") });
  }, [id, keyB64, t]);

  useEffect(() => {
    if (state.status === "revealed" && state.allowDiscussion && id) {
      loadComments(id, true);
      pollRef.current = setInterval(() => loadComments(id, false), POLL_INTERVAL_MS);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [state.status, id]);

  async function loadComments(pasteId: string, isInitial: boolean) {
    if (isInitial) setCommentsLoading(true);
    try {
      const raw: RawComment[] = await fetchComments(pasteId);
      const freshOnes = raw.filter((c) => !knownCommentIds.current.has(c.id));
      if (freshOnes.length === 0) return;
      const decrypted = await Promise.all(freshOnes.map(async (c) => {
        const nick = await decryptComment(c.nickname_cipher, c.nickname_iv, keyB64);
        const text = await decryptComment(c.comment_cipher, c.comment_iv, keyB64);
        return { id: c.id, nickname: nick, text, createdAt: c.created_at };
      }));
      freshOnes.forEach((c) => knownCommentIds.current.add(c.id));
      setComments((prev) => [...prev, ...decrypted].sort((a, b) => a.createdAt - b.createdAt));
      if (!isInitial && decrypted.length > 0) setNewCommentCount((n) => n + decrypted.length);
    } catch { } finally {
      if (isInitial) setCommentsLoading(false);
    }
  }

  function scrollToBottom() {
    setNewCommentCount(0);
    commentListRef.current?.lastElementChild?.scrollIntoView({ behavior: "smooth" });
  }

  async function handleReveal() {
    if (!id) return;
    setState({ status: "fetching" });
    try {
      const data = await fetchPaste(id);
      if (data.hasPassword) setState({ status: "password", data, attemptError: false });
      else await attemptDecrypt(data, null);
    } catch (e: any) {
      setState({ status: "error", message: e?.message === "not_found" ? t("view.error.not_found") : t("view.error.load") });
    }
  }

  async function attemptDecrypt(data: FetchedData, password: string | null) {
    setPending(true);
    try {
      const payload = await decryptPaste(data.ciphertext, data.iv, data.salt, keyB64, password);
      const meta = { burnAfterRead: data.burnAfterRead, allowDiscussion: data.allowDiscussion };
      setState({ status: "revealed", payload, ...meta });
      if (id) cacheReveal(id, payload, meta);
    } catch {
      if (data.hasPassword) setState({ status: "password", data, attemptError: true });
      else setState({ status: "error", message: t("view.error.corrupt") });
    } finally { setPending(false); }
  }

  async function handlePostComment() {
    if (!id || !commentText.trim()) return;
    const nick = nickname.trim() || t("discussion.anon", { defaultValue: "Anonymous" });
    setPostingComment(true); setCommentError(null);
    try {
      const { cipher: nickCipher, iv: nickIv } = await encryptComment(nick, keyB64);
      const { cipher: commentCipher, iv: commentIv } = await encryptComment(commentText.trim(), keyB64);
      const { id: commentId, createdAt } = await postComment(id, { nicknameCipher: nickCipher, nicknameIv: nickIv, commentCipher, commentIv });
      const newComment = { id: commentId, nickname: nick, text: commentText.trim(), createdAt };
      knownCommentIds.current.add(commentId);
      setComments((prev) => [...prev, newComment]);
      setCommentText("");
      setTimeout(scrollToBottom, 50);
    } catch { setCommentError(t("discussion.error")); } finally { setPostingComment(false); }
  }

  function formatTime(ts: number) {
    return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function avatarLetter(nick: string) { return nick.charAt(0).toUpperCase(); }
  function avatarColor(nick: string) {
    const colors = ["#5b8cff","#a78bfa","#34d399","#f472b6","#fb923c","#38bdf8","#facc15","#4ade80"];
    let hash = 0;
    for (let i = 0; i < nick.length; i++) hash = nick.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  if (state.status === "error") return (
    <div className="card"><h2>{t("view.error.title")}</h2><p className="muted">{state.message}</p></div>
  );

  if (state.status === "confirm") return (
    <div className="card">
      <h2>{t("view.confirm.title")}</h2>
      <p className="muted">{t("view.confirm.subtitle")}</p>
      <button onClick={handleReveal}>{t("view.confirm.reveal")}</button>
    </div>
  );

  if (state.status === "fetching") return <div className="card">{t("view.loading")}</div>;

  if (state.status === "password") return (
    <div className="card">
      <h2>{t("view.password.title")}</h2>
      <p className="muted">{t("view.password.subtitle")}</p>
      <input type="password" className="password-input" placeholder={t("view.password.placeholder")}
        value={passwordInput} autoFocus
        onChange={(e) => setPasswordInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") attemptDecrypt(state.data, passwordInput); }} />
      {state.attemptError && <p className="error">{t("view.password.wrong")}</p>}
      <button disabled={pending || !passwordInput} onClick={() => attemptDecrypt(state.data, passwordInput)}>
        {pending ? t("view.password.decrypting") : t("view.password.decrypt")}
      </button>
    </div>
  );

  return (
    <>
      <div className="card">
        <h2>{t("view.revealed.title")}</h2>
        {state.burnAfterRead && <p className="warn">{t("view.revealed.burn")}</p>}
        {renderPayload(state.payload)}

        {state.payload.file && (() => {
          const f = state.payload.file!;
          function downloadFile() {
            const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
            const blob = new Blob([bytes], { type: f.type });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = f.name; a.click();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
          }
          return (
            <div className="file-download-box">
              <span className="file-download-icon">{fileIcon(f.type)}</span>
              <div className="file-download-info">
                <span className="file-download-name">{f.name}</span>
                <span className="file-download-size">{formatBytes(f.size)}</span>
              </div>
              <button className="file-download-btn" onClick={downloadFile}>{t("view.file.download")}</button>
            </div>
          );
        })()}
      </div>

      {state.allowDiscussion && (
        <div className="discussion-section">
          <div className="discussion-header">
            <span className="discussion-title">{t("discussion.title")}</span>
            <span className="discussion-subtitle">{t("discussion.subtitle", { seconds: POLL_INTERVAL_MS / 1000 })}</span>
          </div>

          {newCommentCount > 0 && (
            <button className="new-comments-banner" onClick={scrollToBottom}>
              {newCommentCount === 1 ? t("discussion.new_one", { count: newCommentCount }) : t("discussion.new_many", { count: newCommentCount })}
            </button>
          )}

          <div className="comment-list" ref={commentListRef}>
            {commentsLoading && <p className="muted discussion-loading">{t("discussion.loading")}</p>}
            {!commentsLoading && comments.length === 0 && <p className="muted discussion-empty">{t("discussion.empty")}</p>}
            {comments.map((c) => (
              <div key={c.id} className="comment-item">
                <div className="comment-avatar" style={{ background: avatarColor(c.nickname) }}>{avatarLetter(c.nickname)}</div>
                <div className="comment-body">
                  <div className="comment-meta">
                    <span className="comment-nickname">{c.nickname}</span>
                    <span className="comment-time">{formatTime(c.createdAt)}</span>
                  </div>
                  <p className="comment-text">{c.text}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="comment-form">
            <input className="comment-nick-input" type="text" placeholder={t("discussion.nickname")}
              value={nickname} maxLength={40} onChange={(e) => setNickname(e.target.value)} />
            <div className="comment-input-row">
              <textarea className="comment-textarea" placeholder={t("discussion.placeholder")}
                value={commentText} rows={3} onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handlePostComment(); }} />
              <button className="comment-submit" disabled={postingComment || !commentText.trim()} onClick={handlePostComment}>
                {postingComment ? t("discussion.posting") : t("discussion.post")}
              </button>
            </div>
            {commentError && <p className="error">{commentError}</p>}
            <p className="muted comment-hint">{t("discussion.hint")}</p>
          </div>
        </div>
      )}
    </>
  );
}
