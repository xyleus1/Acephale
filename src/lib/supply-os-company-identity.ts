const MAX_DISCOVERY_CANDIDATES = 8;
const COMPANY_COMMAND_PREFIX = /^(?:(?:please|can you|could you|would you)\s+)?(?:(?:do|research|map|profile|analy[sz]e|find|look\s+up|build|create)\s+)+(?:a\s+)?(?:customer\s+)?(?:company\s+)?(?:dashboard\s+)?(?:for\s+)?/i;
const COMPANY_NAME_STOP = /\b(?:website|located|based|headquartered|builds?|makes?|manufactures?|designs?|develops?|produces?|operates?|sources?|ships?|sells?|serves?)\b/i;
const IDENTITY_STOP_WORDS = new Set([
  "and", "company", "corp", "corporation", "group", "home", "homepage", "inc", "llc", "ltd", "official", "the", "website",
]);

export function identityTokens(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 1 && !IDENTITY_STOP_WORDS.has(token));
}

export function companyNameHint(query: string): string | null {
  const withoutWebsite = query
    .replace(/https?:\/\/[^\s,;)}\]]+/gi, " ")
    .replace(/(?:^|\s)(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s,;)}\]]*)?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const firstClause = withoutWebsite.split(/[.;\n]|\s+-\s+/)[0]?.trim() ?? "";
  const cleaned = firstClause
    .replace(COMPANY_COMMAND_PREFIX, "")
    .replace(/^(?:the\s+)?company\s+/i, "")
    .split(COMPANY_NAME_STOP)[0]
    ?.split(/\s+(?:in|at)\s+(?=[A-Za-z])/i)[0]
    ?.replace(/[^A-Za-z0-9&.' -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned.length < 2 || cleaned.length > 80) return null;
  const words = cleaned.split(" ").filter(Boolean).slice(0, 8);
  if (!words.length || words.every((word) => IDENTITY_STOP_WORDS.has(word.toLowerCase()))) return null;
  return words.map((word) => {
    if (/^[A-Z0-9&.'-]{2,}$/.test(word)) return word;
    return `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;
  }).join(" ");
}

export function officialWebsiteCandidates(query: string): string[] {
  const name = companyNameHint(query);
  if (!name) return [];
  const tokens = identityTokens(name);
  if (!tokens.length) return [];
  const compact = tokens.join("").slice(0, 48);
  const hyphenated = tokens.join("-").slice(0, 48);
  const hosts = [
    `${compact}.com`,
    `${compact}.co`,
    `${compact}.io`,
    `${compact}.ai`,
    `${hyphenated}.com`,
    `${hyphenated}.co`,
    `get${compact}.com`,
    `use${compact}.com`,
  ];
  return [...new Set(hosts)].slice(0, MAX_DISCOVERY_CANDIDATES).map((host) => `https://${host}/`);
}
