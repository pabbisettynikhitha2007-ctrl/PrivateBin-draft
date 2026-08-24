import { marked } from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js";
import "highlight.js/styles/github-dark.css";
import type { PastePayload } from "./crypto";

// Renders a decrypted paste based on its format.
// Markdown output is sanitized with DOMPurify before being injected as HTML —
// necessary since marked() can produce arbitrary HTML from untrusted input.
export function renderPayload(payload: PastePayload) {
  if (payload.format === "markdown") {
    const rawHtml = marked.parse(payload.content, { async: false }) as string;
    const cleanHtml = DOMPurify.sanitize(rawHtml);
    return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: cleanHtml }} />;
  }

  if (payload.format === "source") {
    const highlighted = hljs.highlightAuto(payload.content).value;
    return (
      <pre className="paste-content code-block">
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    );
  }

  // plain text — no HTML interpretation at all, just literal text
  return <pre className="paste-content">{payload.content}</pre>;
}
