// passwordStrength.ts — purely client-side password strength analysis.
// Never sends the password anywhere. Never stores it.

export type StrengthLevel = 0 | 1 | 2 | 3;

export interface StrengthResult {
  score: StrengthLevel;
  label: "Weak" | "Fair" | "Strong" | "Very Strong";
  feedback: string[];
  color: string;
  percent: number;
}

const COMMON_PATTERNS = [
  "password", "123456", "qwerty", "abc123", "letmein", "admin",
  "welcome", "monkey", "dragon", "master", "sunshine", "princess",
  "passw0rd", "iloveyou", "football", "superman", "batman",
  "1234", "12345", "111111", "000000", "654321",
];

function calcEntropy(s: string): number {
  const freq: Record<string, number> = {};
  for (const c of s) freq[c] = (freq[c] ?? 0) + 1;
  const len = s.length;
  let e = 0;
  for (const k of Object.keys(freq)) {
    const p = freq[k] / len;
    e -= p * Math.log2(p);
  }
  return e;
}

function hasRepeats(s: string): boolean {
  return /(.)\1{2,}/.test(s);
}

function hasSequential(s: string): boolean {
  for (let i = 0; i < s.length - 2; i++) {
    const d1 = s.charCodeAt(i + 1) - s.charCodeAt(i);
    const d2 = s.charCodeAt(i + 2) - s.charCodeAt(i + 1);
    if (d1 === 1 && d2 === 1) return true;
    if (d1 === -1 && d2 === -1) return true;
  }
  return false;
}

export function analyzePassword(password: string): StrengthResult {
  if (!password) {
    return { score: 0, label: "Weak", feedback: [], color: "#ff6b6b", percent: 0 };
  }

  const feedback: string[] = [];
  let score = 0;

  // Length checks
  if (password.length < 8) {
    feedback.push("Too short (minimum 8 characters)");
  } else if (password.length >= 12) {
    score += 1;
  }
  if (password.length >= 16) score += 1;

  // Character class checks
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  const onlyDigits = /^\d+$/.test(password);
  const onlyLetters = /^[A-Za-z]+$/.test(password);

  if (onlyDigits) feedback.push("Only numbers — add letters and symbols");
  if (onlyLetters) feedback.push("Only letters — add numbers and symbols");
  if (!hasUpper && !onlyDigits) feedback.push("Add uppercase letters");
  if (!hasDigit && !onlyLetters) feedback.push("Add numbers");
  if (!hasSymbol) feedback.push("Add symbols (!, @, #, …)");

  // Variety score
  const variety = [hasUpper, hasLower, hasDigit, hasSymbol].filter(Boolean).length;
  if (variety >= 3) score += 1;
  if (variety === 4) score += 1;

  // Common patterns
  const lower = password.toLowerCase();
  if (COMMON_PATTERNS.some((p) => lower.includes(p))) {
    feedback.push("Contains a common/guessable pattern");
    score = Math.max(0, score - 1);
  }

  // Repeating characters
  if (hasRepeats(password)) {
    feedback.push("Avoid repeated characters (aaa, 111, …)");
    score = Math.max(0, score - 1);
  }

  // Sequential characters
  if (hasSequential(password)) {
    feedback.push("Avoid sequential characters (abc, 123, …)");
  }

  // Entropy bonus
  const entropy = calcEntropy(password);
  if (entropy > 3.5 && password.length >= 10) score += 1;

  // Cap score at 3
  const finalScore = Math.min(3, Math.max(0, score)) as StrengthLevel;

  const levels: Array<{ label: StrengthResult["label"]; color: string; percent: number }> = [
    { label: "Weak",        color: "#ff6b6b", percent: 25 },
    { label: "Fair",        color: "#ffb454", percent: 50 },
    { label: "Strong",      color: "#34d399", percent: 75 },
    { label: "Very Strong", color: "#5b8cff", percent: 100 },
  ];

  const level = levels[finalScore];

  // If no specific feedback, give a positive message
  if (feedback.length === 0 && finalScore >= 2) {
    feedback.push(finalScore === 3 ? "Excellent password!" : "Good password — consider adding symbols for extra strength");
  }

  return { score: finalScore, label: level.label, feedback, color: level.color, percent: level.percent };
}
