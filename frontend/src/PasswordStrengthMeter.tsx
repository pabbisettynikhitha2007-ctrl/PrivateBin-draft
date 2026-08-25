// PasswordStrengthMeter.tsx — visual password strength indicator.
// Purely presentational — receives strength data, renders the meter.
// Password never leaves this component or the browser.

import { analyzePassword, type StrengthResult } from "./passwordStrength";

interface Props {
  password: string;
}

export default function PasswordStrengthMeter({ password }: Props) {
  if (!password) return null;

  const result: StrengthResult = analyzePassword(password);

  return (
    <div className="strength-meter" aria-label={`Password strength: ${result.label}`}>
      <div className="strength-bar-track">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="strength-bar-segment"
            style={{
              background: i <= result.score ? result.color : "rgba(255,255,255,0.08)",
              transition: "background 0.3s ease",
            }}
          />
        ))}
      </div>
      <div className="strength-label" style={{ color: result.color }}>
        {result.label}
      </div>
      {result.feedback.length > 0 && (
        <ul className="strength-feedback">
          {result.feedback.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
