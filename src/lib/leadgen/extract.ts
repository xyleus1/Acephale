// Pure extraction helpers. Everything here works on already fetched text so
// the parsing rules stay unit testable without live internet.

export const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g;
const OBFUSCATED_EMAIL_PATTERN =
  /([A-Za-z0-9._%+-]+)\s*(?:\(at\)|\[at\]|\s+at\s+|@)\s*([A-Za-z0-9.-]+?)\s*(?:\(dot\)|\[dot\]|\s+dot\s+|\.)\s*([A-Za-z]{2,24}(?:\.[A-Za-z]{2,24})?)/gi;
export const PHONE_PATTERN = /(?:\+90|0090|0)?[\s(.-]*([2-5]\d{2})[\s).-]*(\d{3})[\s.-]*(\d{2})[\s.-]*(\d{2})/g;

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|svg|webp|ico|css|js|woff2?)$/i;
const ROLE_LOCAL_PARTS = new Set([
  "info",
  "bilgi",
  "iletisim",
  "contact",
  "sales",
  "satis",
  "satinalma",
  "purchasing",
  "export",
  "ihracat",
  "ithalat",
  "import",
  "muhasebe",
  "finance",
  "destek",
  "support",
  "kariyer",
  "hr",
  "ik",
  "admin",
  "office",
  "mail",
  "webmaster",
  "noreply",
  "no-reply",
  "postmaster",
  "abuse",
  "kvkk",
]);

const TURKISH_CITIES = [
  "adana", "adiyaman", "afyon", "agri", "aksaray", "amasya", "ankara", "antalya", "ardahan", "artvin",
  "aydin", "balikesir", "bartin", "batman", "bayburt", "bilecik", "bingol", "bitlis", "bolu", "burdur",
  "bursa", "canakkale", "cankiri", "corum", "denizli", "diyarbakir", "duzce", "edirne", "elazig",
  "erzincan", "erzurum", "eskisehir", "gaziantep", "giresun", "gumushane", "hakkari", "hatay", "igdir",
  "isparta", "istanbul", "izmir", "kahramanmaras", "karabuk", "karaman", "kars", "kastamonu", "kayseri",
  "kilis", "kirikkale", "kirklareli", "kirsehir", "kocaeli", "konya", "kutahya", "malatya", "manisa",
  "mardin", "mersin", "mugla", "mus", "nevsehir", "nigde", "ordu", "osmaniye", "rize", "sakarya",
  "samsun", "sanliurfa", "siirt", "sinop", "sivas", "sirnak", "tekirdag", "tokat", "trabzon", "tunceli",
  "usak", "van", "yalova", "yozgat", "zonguldak",
];

export const COMPANY_SUFFIX_PATTERN =
  /\b(a\.?\s?s\.?|s\.?\s*r\.?\s*l\.?|srl|spa|s\.?\s*l\.?|ltda|pvt\.?\s+ltd|jsc|pjsc|llc|ltd\.?\s?sti\.?|limited|sanayi|san\.?|ticaret|tic\.?|holding|group|grup|makina|makine|metal|celik|çelik|demir|dokum|insaat|muhendislik|otomotiv|steel|acero|aciers|стали|stahl|acciaio|industries|industry|gmbh|ooo|ооо|зао|sp\.\s*z\.\s*o\.o\.|inc\.?|corp\.?)\b/i;

export function normalizeTurkish(value: string) {
  return value
    .replace(/[İIı]/g, (match) => (match === "ı" ? "i" : "I"))
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/â/g, "a");
}

export function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>(?=)/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n")
    .trim();
}

export function extractTitle(html: string) {
  const og = /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i.exec(html);
  if (og?.[1]) return og[1].trim();
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!title?.[1]) return null;
  return htmlToText(title[1]).split(/[|\u2013\-\u00bb:]/)[0]?.trim() || null;
}

export function extractEmails(text: string) {
  const found = new Set<string>();
  for (const raw of text.match(EMAIL_PATTERN) ?? []) {
    const email = raw.toLowerCase().replace(/[.,;)]+$/, "");
    if (IMAGE_EXTENSIONS.test(email)) continue;
    if (email.includes("example.") || email.includes("sentry.io") || email.includes("wixpress")) continue;
    found.add(email);
  }
  for (const match of text.matchAll(OBFUSCATED_EMAIL_PATTERN)) {
    const email = `${match[1]}@${match[2]}.${match[3]}`.toLowerCase();
    if (!IMAGE_EXTENSIONS.test(email)) found.add(email);
  }
  return [...found];
}

export function extractPhones(text: string) {
  const found = new Set<string>();
  for (const match of text.matchAll(PHONE_PATTERN)) {
    found.add(`+90 ${match[1]} ${match[2]} ${match[3]} ${match[4]}`);
  }
  return [...found];
}

export function extractCity(text: string, regions: readonly string[] = TURKISH_CITIES) {
  const normalized = normalizeTurkish(text);
  let best: { city: string; index: number } | null = null;
  for (const city of regions) {
    const normalizedCity = normalizeTurkish(city);
    const escapedCity = normalizedCity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const index = normalized.search(new RegExp(`(?<![\\p{L}\\p{N}_])${escapedCity}(?![\\p{L}\\p{N}_])`, "u"));
    if (index >= 0 && (best === null || index < best.index)) {
      best = { city, index };
    }
  }
  if (!best) return null;
  return best.city.charAt(0).toUpperCase() + best.city.slice(1);
}

export function extractCompanyName(html: string, text: string, domain: string) {
  const title = extractTitle(html);
  if (title && title.length >= 3 && title.length <= 90) return title;
  const suffixLine = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length >= 6 && line.length <= 90 && COMPANY_SUFFIX_PATTERN.test(line));
  if (suffixLine) return suffixLine;
  const bare = domain.replace(/^www\./, "").split(".")[0] ?? domain;
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

export function isRoleEmail(email: string) {
  const local = email.split("@")[0] ?? "";
  return ROLE_LOCAL_PARTS.has(local.replace(/\d+$/, ""));
}

export function emailDomain(email: string) {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

export function registrableDomain(hostOrUrl: string) {
  let host = hostOrUrl;
  try {
    host = new URL(hostOrUrl.includes("://") ? hostOrUrl : `https://${hostOrUrl}`).hostname;
  } catch {
    // Fall through with the raw value.
  }
  host = host.toLowerCase().replace(/^www\./, "");
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const twoLevelTlds = ["com.tr", "net.tr", "org.tr", "gov.tr", "co.uk", "com.de"];
  const lastTwo = parts.slice(-2).join(".");
  if (twoLevelTlds.includes(lastTwo)) return parts.slice(-3).join(".");
  return lastTwo;
}

/** Pull absolute and relative links out of raw HTML, resolved against baseUrl. */
export function extractLinks(html: string, baseUrl: string) {
  const links = new Set<string>();
  for (const match of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    const raw = match[1]?.trim();
    if (!raw || raw.startsWith("mailto:") || raw.startsWith("tel:") || raw.startsWith("javascript:")) continue;
    if (IMAGE_EXTENSIONS.test(raw)) continue;
    try {
      links.add(new URL(raw, baseUrl).toString());
    } catch {
      continue;
    }
  }
  return [...links];
}

const CONTACT_PATH_HINTS = [
  "iletisim", "contact", "hakkimizda", "about", "kurumsal", "bize-ulasin",
  "irtibat", "impressum", "kunye",
];

export function pickContactLinks(links: readonly string[], baseUrl: string, limit = 4) {
  const base = registrableDomain(baseUrl);
  const scored = links
    .filter((link) => registrableDomain(link) === base)
    .map((link) => {
      const normalized = normalizeTurkish(link);
      const hit = CONTACT_PATH_HINTS.findIndex((hint) => normalized.includes(hint));
      return { link, rank: hit < 0 ? Number.MAX_SAFE_INTEGER : hit };
    })
    .filter((entry) => entry.rank !== Number.MAX_SAFE_INTEGER)
    .sort((a, b) => a.rank - b.rank);
  const unique: string[] = [];
  for (const entry of scored) {
    if (!unique.includes(entry.link)) unique.push(entry.link);
    if (unique.length >= limit) break;
  }
  return unique;
}
