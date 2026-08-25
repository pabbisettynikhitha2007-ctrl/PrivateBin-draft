// qrUtils.ts — client-side QR code generation.
// The full URL (including the #fragment decryption key) is encoded in the QR.
// This is intentional: sharing the QR is equivalent to sharing the link directly.
// NO server round-trip. NO plaintext of the secret itself is in the QR.

/**
 * Generates a QR code data-URL for the given text using a lightweight
 * pure-JavaScript implementation (no native dependencies).
 *
 * Returns a PNG data URL suitable for use as <img src={...} />.
 */
export async function generateQRDataUrl(text: string, size = 256): Promise<string> {
  // Dynamic import so the QR library is only loaded when needed
  const QRCode = await import("qrcode");
  return QRCode.toDataURL(text, {
    width: size,
    margin: 2,
    color: {
      dark: "#e6e8ec",   // match --text CSS var
      light: "#171a21",  // match --card-bg CSS var
    },
    errorCorrectionLevel: "M",
  });
}
