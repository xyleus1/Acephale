const HTML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPE[char] ?? char);
}
