const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000/api";

export async function createPaste(params: {
  ciphertext: string;
  iv: string;
  salt: string;
  hasPassword: boolean;
  burnAfterRead: boolean;
  ttlSeconds: number | null;
  allowDiscussion: boolean;
}): Promise<{ id: string; expiresAt: number | null; allowDiscussion: boolean }> {
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
}> {
  const res = await fetch(`${API_BASE}/paste/${id}`);
  if (res.status === 404) throw new Error("not_found");
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
