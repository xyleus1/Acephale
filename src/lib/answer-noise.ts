// Junk detection for lead-form answers ("I don't know", "bilmiyorum", "-",
// pasted nonsense). A structured Inquiry field fed from a form answer stays
// BLANK when the answer is noise - the raw text remains visible in the
// read-only form-answers section, so nothing is lost, just not promoted.
//
// Scope: apply only to open-text identity/lane fields (origin, destination,
// commodity, company, name, job title). Never to YES/NO style answers, where
// "no" is a real value.

const NOISE_EXACT = new Set([
  "-", "--", ".", "..", "...", "?", "??", "n/a", "na", "none", "no", "yok",
  "idk", "i dont know", "i don't know", "dont know", "don't know", "unknown",
  "bilmiyorum", "bilmem", "bilemiyorum", "belli degil", "belli değil",
  "bos", "boş", "test", "asdf", "asd", "abc", "xxx", "xx", "x", "yıok",
]);

const NOISE_PATTERNS = [
  /^i\s*do\s*n[o']?t\s*know/i,
  /^not\s*sure/i,
  /^no\s*idea/i,
  /^bilmiyorum/i,
  /^bilmem/i,
  /^emin\s*degil/i,
  /^emin\s*değil/i,
  /^belirsiz/i,
  /^henuz\s*belli/i,
  /^henüz\s*belli/i,
];

export function isNoiseAnswer(value: string | null | undefined): boolean {
  if (value == null) return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  const normalized = trimmed.toLocaleLowerCase("tr-TR").replace(/[!.\s]+$/g, "");
  if (NOISE_EXACT.has(normalized)) return true;
  return NOISE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

// Promote a form answer into a structured field: trimmed value, or null when
// it is noise.
export function cleanAnswer(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed && !isNoiseAnswer(trimmed) ? trimmed : null;
}
