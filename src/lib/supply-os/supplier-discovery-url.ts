const NON_SUPPLIER_REFERENCE_DOMAINS = [
  "academia.edu",
  "arxiv.org",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "medium.com",
  "pinterest.com",
  "quora.com",
  "reddit.com",
  "researchgate.net",
  "semanticscholar.org",
  "stackexchange.com",
  "stackoverflow.com",
  "tiktok.com",
  "twitter.com",
  "wikipedia.org",
  "wikimedia.org",
  "x.com",
  "youtu.be",
  "youtube.com",
] as const;

const GOVERNMENT_OR_ACADEMIC_DOMAIN_LABELS = new Set([
  "ac",
  "edu",
  "gc",
  "go",
  "gob",
  "gouv",
  "gov",
]);

function matchesDomain(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function isSupplierDiscoveryUrl(value: unknown) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return false;
    const hostname = url.hostname.toLowerCase().replace(/^www\./u, "").replace(/\.$/u, "");
    const unwrappedHostname = hostname.replace(/^\[|\]$/gu, "");
    const ipv4Labels = unwrappedHostname.split(".");
    const isIpv4Literal = ipv4Labels.length === 4 && ipv4Labels.every((label) => /^\d{1,3}$/u.test(label) && Number(label) <= 255);
    if (
      !hostname
      || hostname === "localhost"
      || hostname.endsWith(".local")
      || hostname.endsWith(".internal")
      || isIpv4Literal
      || unwrappedHostname.includes(":")
      || NON_SUPPLIER_REFERENCE_DOMAINS.some((domain) => matchesDomain(hostname, domain))
    ) return false;
    const labels = hostname.split(".").filter(Boolean);
    const topLevelLabel = labels.at(-1) ?? "";
    const publicSectorLabel = labels.at(-2) ?? "";
    if (["edu", "gov", "mil"].includes(topLevelLabel)) return false;
    if (labels.length >= 3 && GOVERNMENT_OR_ACADEMIC_DOMAIN_LABELS.has(publicSectorLabel)) return false;
    return true;
  } catch {
    return false;
  }
}
