/**
 * PII Redaction Utility
 * Strips common PII patterns from text before storage.
 * In production, use a dedicated service (AWS Comprehend, Presidio, etc.)
 */

const PII_PATTERNS: Array<{ name: string; regex: RegExp; replacement: string }> = [
  // Email addresses
  {
    name: "email",
    regex: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    replacement: "[EMAIL]",
  },
  // Phone numbers (US + international)
  {
    name: "phone",
    regex: /(\+?1[-.\s]?)?(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/g,
    replacement: "[PHONE]",
  },
  // Credit card numbers
  {
    name: "credit_card",
    regex: /\b(?:\d[ -]?){13,16}\b/g,
    replacement: "[CARD]",
  },
  // Social Security Numbers
  {
    name: "ssn",
    regex: /\b\d{3}[-]?\d{2}[-]?\d{4}\b/g,
    replacement: "[SSN]",
  },
  // IP addresses
  {
    name: "ip_address",
    regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: "[IP]",
  },
  // API keys / tokens (long alphanumeric strings)
  {
    name: "api_key",
    regex: /\b(sk-|pk-|Bearer\s+)?[A-Za-z0-9_\-]{32,}\b/g,
    replacement: "[TOKEN]",
  },
];

export function redactPII(text: string): string {
  let redacted = text;
  for (const pattern of PII_PATTERNS) {
    redacted = redacted.replace(pattern.regex, pattern.replacement);
  }
  return redacted;
}

export function makePreview(text: string, maxLength = 200): string {
  const redacted = redactPII(text);
  if (redacted.length <= maxLength) return redacted;
  return redacted.slice(0, maxLength) + "…";
}
