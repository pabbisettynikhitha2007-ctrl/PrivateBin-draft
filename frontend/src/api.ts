const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000/api";

export async function createPaste(params: {
  ciphertext: string;
  iv: string;
  salt: string;
  hasPassword: boolean;
  burnAfterRead: boolean;
  ttlSeconds: number | null;
  allowDiscussion: boolean;
  sensitivityMode?: "normal" | "sensitive" | "very_sensitive";
  decoyCiphertext?: string;
  decoyIv?: string;
  decoySalt?: string;
  recipientEmail?: string;
}): Promise<{ id: string; expiresAt: number | null; allowDiscussion: boolean; ownerToken: string }> {
  const res = await fetch(`${API_BASE}/paste`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error("Failed to create paste");
  return res.json();
}

export async function fetchPaste(id: string): Promise<{
  ciphertext: string;
  iv: string;
  salt: string;
  hasPassword: boolean;
  burnAfterRead: boolean;
  allowDiscussion: boolean;
  sensitivityMode: "normal" | "sensitive" | "very_sensitive";
  hasDecoy: boolean;
  decoyCiphertext?: string;
  decoyIv?: string;
  decoySalt?: string;
}> {
  const res = await fetch(`${API_BASE}/paste/${id}`);
  if (res.status === 404) throw new Error("not_found");
  if (res.status === 410) throw new Error("revoked");
  if (!res.ok) throw new Error("Failed to fetch paste");
  return res.json();
}

export interface RawComment {
  id: string;
  nickname_cipher: string;
  nickname_iv: string;
  comment_cipher: string;
  comment_iv: string;
  created_at: number;
}

export async function fetchComments(pasteId: string): Promise<RawComment[]> {
  const res = await fetch(`${API_BASE}/paste/${pasteId}/comments`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.comments as RawComment[];
}

export async function postComment(
  pasteId: string,
  payload: {
    nicknameCipher: string;
    nicknameIv: string;
    commentCipher: string;
    commentIv: string;
  }
): Promise<{ id: string; createdAt: number }> {
  const res = await fetch(`${API_BASE}/paste/${pasteId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to post comment");
  return res.json();
}

export async function recordAccess(pasteId: string): Promise<{ accessId: string }> {
  try {
    const res = await fetch(`${API_BASE}/paste/${pasteId}/access-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) return { accessId: "" };
    return res.json();
  } catch {
    return { accessId: "" };
  }
}

export async function revokePaste(
  pasteId: string,
  ownerToken: string
): Promise<void> {
  const res = await fetch(`${API_BASE}/paste/${pasteId}/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerToken }),
  });
  if (!res.ok) throw new Error("Failed to revoke");
}

export interface AccessEntry {
  id: string;
  accessed_at: number;
  verified_email: string | null;
  verified_at: number | null;
}

export interface PasteStatus {
  id: string;
  revoked: boolean;
  expiresAt: number | null;
  sensitivityMode: "normal" | "sensitive" | "very_sensitive";
  accessCount: number;
  accesses: AccessEntry[];
}

export async function fetchPasteStatus(
  pasteId: string,
  ownerToken: string
): Promise<PasteStatus> {
  const res = await fetch(`${API_BASE}/paste/${pasteId}/status?ownerToken=${encodeURIComponent(ownerToken)}`);
  if (res.status === 403) throw new Error("unauthorized");
  if (!res.ok) throw new Error("Failed to fetch status");
  return res.json();
}

export async function requestRecipientVerification(
  pasteId: string,
  email: string
): Promise<{ verifyToken: string; verifyUrl: string }> {
  const res = await fetch(`${API_BASE}/paste/${pasteId}/verify-identity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error("Failed to request verification");
  return res.json();
}
