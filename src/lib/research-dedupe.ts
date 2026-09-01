function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

export function normalizeDedupeValue(value: unknown): string | null {
  const normalized = cleanText(value).toLowerCase();
  if (!normalized) return null;
  return normalized
    .replace(/^[a-z][a-z\d+.-]*:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "")
    .trim() || null;
}
