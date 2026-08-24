// Page harvesting: fetch a candidate site, read its home and contact pages,
// pull out identity and contact evidence, and score fit against the profile.
// PDF sources are supported because Turkish chambers and industrial zones
// publish member directories as PDF files.

import {
  emailDomain,
  extractCity,
  extractCompanyName,
  extractEmails,
  extractLinks,
  extractPhones,
  htmlToText,
  pickContactLinks,
  registrableDomain,
} from "./extract";
import type { LeadGenProfile } from "./profile";
import { scoreLead, type LeadFitResult } from "./score";

export type FetchedPage = {
  url: string;
  status: number;
  contentType: string;
  body: string;
  isPdf: boolean;
};

export type PageFetcher = (url: string) => Promise<FetchedPage | null>;

export type LeadEvidence = {
  url: string;
  kind: "home" | "contact" | "directory" | "pdf";
  emails: string[];
  phones: string[];
};

export type LeadCandidate = {
  domain: string;
  website: string;
  companyName: string;
  city: string | null;
  emails: string[];
  phones: string[];
  segmentKey: string | null;
  fit: LeadFitResult;
  evidence: LeadEvidence[];
  discoveredVia: string;
  harvestedAt: string;
};

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export const defaultFetcher: PageFetcher = async (url) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, "accept-language": "tr,en;q=0.8" },
    });
    const contentType = response.headers.get("content-type") ?? "";
    const isPdf = contentType.includes("pdf") || url.toLowerCase().endsWith(".pdf");
    if (isPdf) {
      const buffer = Buffer.from(await response.arrayBuffer());
      return { url: response.url || url, status: response.status, contentType, body: await readPdf(buffer), isPdf: true };
    }
    if (!contentType.includes("html") && !contentType.includes("text")) return null;
    return { url: response.url || url, status: response.status, contentType, body: await response.text(), isPdf: false };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

async function readPdf(buffer: Buffer) {
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      const parsed = await parser.getText();
      return parsed.text ?? "";
    } finally {
      await parser.destroy();
    }
  } catch {
    return "";
  }
}

export type HarvestOptions = {
  fetcher?: PageFetcher;
  segmentKey?: string | null;
  discoveredVia?: string;
  maxContactPages?: number;
  now?: () => Date;
};

export async function harvestSite(
  profile: LeadGenProfile,
  siteUrl: string,
  options: HarvestOptions = {},
): Promise<LeadCandidate | null> {
  const fetcher = options.fetcher ?? defaultFetcher;
  const home = await fetcher(siteUrl);
  if (!home || home.status >= 400 || !home.body) return null;

  const domain = registrableDomain(home.url);
  const homeText = home.isPdf ? home.body : htmlToText(home.body);
  const evidence: LeadEvidence[] = [
    {
      url: home.url,
      kind: home.isPdf ? "pdf" : "home",
      emails: extractEmails(home.isPdf ? home.body : `${home.body}\n${homeText}`),
      phones: extractPhones(homeText),
    },
  ];

  let combinedText = homeText;
  if (!home.isPdf) {
    const contactLinks = pickContactLinks(extractLinks(home.body, home.url), home.url, options.maxContactPages ?? 3);
    for (const link of contactLinks) {
      const page = await fetcher(link);
      if (!page || page.status >= 400 || !page.body) continue;
      const text = page.isPdf ? page.body : htmlToText(page.body);
      combinedText = `${combinedText}\n${text}`;
      evidence.push({
        url: page.url,
        kind: page.isPdf ? "pdf" : "contact",
        emails: extractEmails(page.isPdf ? page.body : `${page.body}\n${text}`),
        phones: extractPhones(text),
      });
    }
  }

  const emails = [...new Set(evidence.flatMap((item) => item.emails))]
    .filter((email) => !email.endsWith(".png") && !email.endsWith(".jpg"))
    .sort((a, b) => scoreEmailUsefulness(b, domain) - scoreEmailUsefulness(a, domain));
  const phones = [...new Set(evidence.flatMap((item) => item.phones))];

  const companyName = extractCompanyName(home.isPdf ? "" : home.body, combinedText, domain);
  const fit = scoreLead(profile, {
    companyName,
    domain,
    pageText: combinedText.slice(0, 40_000),
    segmentKey: options.segmentKey ?? null,
    emailCount: emails.length,
    hasPhone: phones.length > 0,
  });

  return {
    domain,
    website: home.url,
    companyName,
    city: extractCity(combinedText.slice(0, 20_000)),
    emails,
    phones,
    segmentKey: options.segmentKey ?? null,
    fit,
    evidence,
    discoveredVia: options.discoveredVia ?? siteUrl,
    harvestedAt: (options.now?.() ?? new Date()).toISOString(),
  };
}

/** Company-domain addresses first, then role inboxes, then everything else. */
export function scoreEmailUsefulness(email: string, companyDomain: string) {
  let score = 0;
  if (registrableDomain(emailDomain(email)) === registrableDomain(companyDomain)) score += 10;
  const local = email.split("@")[0] ?? "";
  if (["satis", "sales", "satinalma", "purchasing", "ithalat", "import"].includes(local)) score += 6;
  if (["info", "bilgi", "iletisim", "contact"].includes(local)) score += 4;
  if (local.includes("noreply") || local.includes("no-reply")) score -= 10;
  return score;
}

/** Pull company site links out of a directory or member-list page. */
export function extractDirectoryTargets(html: string, baseUrl: string) {
  const base = registrableDomain(baseUrl);
  const targets = new Set<string>();
  for (const link of extractLinks(html, baseUrl)) {
    const domain = registrableDomain(link);
    if (!domain || domain === base) continue;
    if (/\.(gov|gob)\./.test(domain)) continue;
    targets.add(`https://${domain}`);
  }
  return [...targets];
}
