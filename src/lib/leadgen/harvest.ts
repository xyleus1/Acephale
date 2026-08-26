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
import { checkPublicUrl, guardedRequest } from "./fetch-guard";
import { parseDirectoryDocument, type DirectoryRow } from "./directory";
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

const MAX_REDIRECTS = 4;

// Redirects are resolved one hop at a time so the egress guard sees every
// target, including hosts a redirect chain from a search result tries to reach.
export const defaultFetcher: PageFetcher = async (url) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    let target = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const check = await checkPublicUrl(target);
      if (!check.ok) return null;
      const response = await guardedRequest(check.url, {
        signal: controller.signal,
        headers: { "user-agent": USER_AGENT, "accept-language": "tr,en;q=0.8" },
      });
      if (response.status >= 300 && response.status < 400) {
        if (!response.location) return null;
        target = new URL(response.location, check.url).toString();
        continue;
      }
      const finalUrl = response.url;
      const contentType = response.headers["content-type"] ?? "";
      const isPdf = contentType.includes("pdf") || finalUrl.toLowerCase().endsWith(".pdf");
      if (isPdf) {
        return { url: finalUrl, status: response.status, contentType, body: await readPdf(response.body), isPdf: true };
      }
      if (!contentType.includes("html") && !contentType.includes("text")) return null;
      return { url: finalUrl, status: response.status, contentType, body: response.body.toString("utf8"), isPdf: false };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const PDF_PARSE_TIMEOUT_MS = 25_000;
const MAX_PDF_BYTES = 25 * 1024 * 1024;

// Large or malformed member-list PDFs can keep the parser busy indefinitely, so
// a sweep over thousands of directory pages needs a hard ceiling per document.
async function readPdf(buffer: Buffer) {
  if (buffer.byteLength > MAX_PDF_BYTES) return "";
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    let timer: NodeJS.Timeout | undefined;
    try {
      const parsed = await Promise.race([
        parser.getText(),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), PDF_PARSE_TIMEOUT_MS);
        }),
      ]);
      return parsed?.text ?? "";
    } finally {
      if (timer) clearTimeout(timer);
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
  directoryMode?: boolean;
  directoryRegions?: readonly string[];
};

export function harvestSite(
  profile: LeadGenProfile,
  siteUrl: string,
  options: HarvestOptions & { directoryMode: true },
): Promise<DirectoryRow[] | LeadCandidate | null>;

export function harvestSite(
  profile: LeadGenProfile,
  siteUrl: string,
  options?: HarvestOptions & { directoryMode?: false },
): Promise<LeadCandidate | null>;

export function harvestSite(
  profile: LeadGenProfile,
  siteUrl: string,
  options: HarvestOptions,
): Promise<DirectoryRow[] | LeadCandidate | null>;

export async function harvestSite(
  profile: LeadGenProfile,
  siteUrl: string,
  options: HarvestOptions = {},
): Promise<LeadCandidate | DirectoryRow[] | null> {
  const fetcher = options.fetcher ?? defaultFetcher;
  const home = await fetcher(siteUrl);
  if (!home || home.status >= 400 || !home.body) return null;

  if (
    options.directoryMode
    && (
      home.isPdf
      || /<table\b/i.test(home.body)
      || home.contentType.includes("csv")
      || home.contentType.includes("tab-separated")
      || home.contentType.includes("text/plain")
    )
  ) {
    const parsed = parseDirectoryDocument(home, { regions: options.directoryRegions });
    if (parsed.looksLikeDirectory && parsed.rows.length > 0) return parsed.rows;
  }

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
