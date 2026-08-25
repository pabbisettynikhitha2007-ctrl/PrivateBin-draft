// sensitivityAnalyzer.ts — local, client-side content sensitivity analysis.
// Runs entirely in the browser using regex / heuristics.
// NEVER sends the analyzed content to any server or external service.
// Clearly labeled as a local rule-based analyzer, not cloud AI.

export type SensitivityLevel = "normal" | "sensitive" | "very_sensitive";

export interface DetectionResult {
  category: string;
  description: string;
  level: SensitivityLevel;
}

export interface AnalysisResult {
  detections: DetectionResult[];
  suggestedLevel: SensitivityLevel;
  highestDetectedLevel: SensitivityLevel;
}

// Shannon entropy — measures randomness. High entropy on a long token = likely a secret.
function shannonEntropy(s: string): number {
  const freq: Record<string, number> = {};
  for (const c of s) freq[c] = (freq[c] ?? 0) + 1;
  const len = s.length;
  let e = 0;
  for (const k in freq) {
    const p = freq[k] / len;
    e -= p * Math.log2(p);
  }
  return e;
}

function highEntropyToken(s: string): boolean {
  // Looking for 20+ char non-whitespace tokens with entropy > 4.0
  const tokens = s.match(/\S{20,}/g) ?? [];
  return tokens.some((t) => {
    // Exclude URLs and base64 image data
    if (t.startsWith("http") || t.startsWith("data:")) return false;
    return shannonEntropy(t) > 4.0;
  });
}

const PATTERNS: Array<{
  name: string;
  description: string;
  level: SensitivityLevel;
  test: (content: string) => boolean;
}> = [
  {
    name: "Private Key / Certificate",
    description: "PEM-encoded private key or certificate detected",
    level: "very_sensitive",
    test: (s) => /-----BEGIN\s+(RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/.test(s),
  },
  {
    name: "AWS Access Key",
    description: "AWS access key ID pattern (AKIA…)",
    level: "very_sensitive",
    test: (s) => /\bAKIA[0-9A-Z]{16}\b/.test(s),
  },
  {
    name: "JWT Token",
    description: "JSON Web Token (three base64url segments separated by dots)",
    level: "very_sensitive",
    test: (s) => /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/.test(s),
  },
  {
    name: "API Key / Bearer Token",
    description: "API key or Bearer authorization token pattern",
    level: "very_sensitive",
    test: (s) =>
      /(?:api[_-]?key|bearer|authorization|auth[_-]?token)\s*[:=]\s*["']?[a-zA-Z0-9_./-]{20,}/i.test(s) ||
      /\bBearer\s+[a-zA-Z0-9._~+/-]+=*/.test(s),
  },
  {
    name: "Database Connection String",
    description: "Database connection string with credentials",
    level: "very_sensitive",
    test: (s) =>
      /(?:mongodb|postgresql|postgres|mysql|redis|mssql|amqp):\/\/[^@\s]+:[^@\s]+@/.test(s) ||
      /(?:connection[_-]?string|connstr)\s*[:=]/i.test(s),
  },
  {
    name: "Password / Secret in Assignment",
    description: "Credential assignment (password=, secret=, etc.)",
    level: "very_sensitive",
    test: (s) =>
      /(?:password|passwd|secret|private[_-]?key|client[_-]?secret|app[_-]?secret)\s*[:=]\s*["']?\S{4,}/i.test(s),
  },
  {
    name: "SSH / GPG Key Block",
    description: "SSH or GPG armored key block",
    level: "very_sensitive",
    test: (s) =>
      /-----BEGIN\s+(PGP|GPG|SSH2?) (PUBLIC |PRIVATE |ENCRYPTED )?/.test(s) ||
      /^ssh-(rsa|ed25519|ecdsa)\s+AAAA/m.test(s),
  },
  {
    name: "High-Entropy Secret",
    description: "Long high-entropy token that looks like a generated secret",
    level: "very_sensitive",
    test: highEntropyToken,
  },
  {
    name: "Credit Card Number",
    description: "Credit card number pattern (16-digit groups)",
    level: "sensitive",
    test: (s) =>
      /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/.test(
        s.replace(/[\s-]/g, "")
      ),
  },
  {
    name: "Social Security Number",
    description: "US SSN pattern (XXX-XX-XXXX)",
    level: "sensitive",
    test: (s) => /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/.test(s),
  },
  {
    name: "Email Address",
    description: "One or more email addresses",
    level: "sensitive",
    test: (s) =>
      (s.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g) ?? []).length > 0,
  },
  {
    name: "Phone Number",
    description: "Phone number pattern",
    level: "sensitive",
    test: (s) =>
      /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(s),
  },
  {
    name: "Security Keywords",
    description: "Security-sensitive keywords detected in context",
    level: "sensitive",
    test: (s) =>
      /\b(?:confidential|top secret|internal only|do not share|not for distribution|proprietary|classified)\b/i.test(s),
  },
  {
    name: "Authentication / Token Keywords",
    description: "Authentication-related keywords",
    level: "sensitive",
    test: (s) =>
      /\b(?:oauth|saml|openid|2fa|totp|mfa|one.?time.?password|otp)\b/i.test(s) &&
      /\b[A-Za-z0-9]{6,}\b/.test(s),
  },
];

export function analyzeSensitivity(content: string): AnalysisResult {
  if (!content || content.trim().length < 5) {
    return { detections: [], suggestedLevel: "normal", highestDetectedLevel: "normal" };
  }

  const detections: DetectionResult[] = [];

  for (const pattern of PATTERNS) {
    try {
      if (pattern.test(content)) {
        detections.push({
          category: pattern.name,
          description: pattern.description,
          level: pattern.level,
        });
      }
    } catch {
      // Regex errors are silently ignored
    }
  }

  let highestDetectedLevel: SensitivityLevel = "normal";
  for (const d of detections) {
    if (d.level === "very_sensitive") { highestDetectedLevel = "very_sensitive"; break; }
    if (d.level === "sensitive") highestDetectedLevel = "sensitive";
  }

  return {
    detections,
    suggestedLevel: highestDetectedLevel,
    highestDetectedLevel,
  };
}
