// Search harvesting without a paid SERP API. Result pages are parsed as plain
// HTML, so any engine that serves markup can be plugged in, and the parser is
// testable against saved fixtures.

import { registrableDomain } from "./extract";

export type SearchEngine = "brave" | "duckduckgo" | "bing";

export type SearchHit = {
  url: string;
  domain: string;
  engine: SearchEngine;
  rank: number;
};

const ENGINE_HOSTS: Record<SearchEngine, readonly string[]> = {
  brave: ["brave.com", "search.brave.com"],
  duckduckgo: ["duckduckgo.com", "duck.com"],
  bing: ["bing.com", "microsoft.com", "msn.com"],
};

const NON_LEAD_HOSTS = [
  "google.", "youtube.com", "facebook.com", "instagram.com", "twitter.com", "x.com",
  "linkedin.com", "pinterest.", "tiktok.com", "wikipedia.org", "sahibinden.com",
  "hepsiburada.com", "trendyol.com", "n11.com", "armut.com", "gittigidiyor.com",
  "amazon.", "alibaba.com", "indeed.com", "kariyer.net", "yenibiris.com", "apple.com",
  "play.google.com", "wordpress.org", "blogspot.com", "medium.com", "reddit.com",
];

// Entries ending in a dot are brand prefixes and match any label boundary.
// Full domains match the host itself or one of its subdomains, so a lead like
// teknomax.com is never mistaken for x.com.
function isNonLeadHost(host: string) {
  return NON_LEAD_HOSTS.some((blocked) =>
    blocked.endsWith(".")
      ? host === blocked.slice(0, -1) || host.startsWith(blocked) || host.includes(`.${blocked}`)
      : host === blocked || host.endsWith(`.${blocked}`),
  );
}

const DUCKDUCKGO_REDIRECT = /^https?:\/\/(?:duckduckgo\.com|links\.duckduckgo\.com)\/l\/\?uddg=([^&]+)/i;

export function parseSearchResults(html: string, engine: SearchEngine): SearchHit[] {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();

  for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
    let raw = match[1]?.trim();
    if (!raw) continue;

    const redirect = DUCKDUCKGO_REDIRECT.exec(raw);
    if (redirect?.[1]) raw = decodeURIComponent(redirect[1]);
    if (!/^https?:\/\//i.test(raw)) continue;

    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    url.hash = "";

    const host = url.hostname.toLowerCase();
    if (ENGINE_HOSTS[engine].some((engineHost) => host.endsWith(engineHost))) continue;
    if (isNonLeadHost(host)) continue;

    const key = url.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({ url: key, domain: registrableDomain(host), engine, rank: hits.length + 1 });
  }

  return hits;
}

export function searchUrl(engine: SearchEngine, query: string, offset = 0) {
  const encoded = encodeURIComponent(query);
  if (engine === "brave") return `https://search.brave.com/search?q=${encoded}&offset=${offset}`;
  if (engine === "duckduckgo") return `https://html.duckduckgo.com/html/?q=${encoded}`;
  return `https://www.bing.com/search?q=${encoded}&first=${offset * 10 + 1}&setlang=tr`;
}

/** Collapse hits to one entry per registrable domain, keeping the best rank. */
export function dedupeByDomain(hits: readonly SearchHit[]) {
  const best = new Map<string, SearchHit>();
  for (const hit of hits) {
    const current = best.get(hit.domain);
    if (!current || hit.rank < current.rank) best.set(hit.domain, hit);
  }
  return [...best.values()];
}
