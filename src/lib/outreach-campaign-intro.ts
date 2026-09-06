import Gpt56Client from "@/lib/gpt56-client";
import { stripEmDashes } from "@/lib/no-em-dash";
import {
  OUTREACH_INTRO_COMMON_WORDS,
  OUTREACH_INTRO_MAX_CHARS,
  OUTREACH_INTRO_SYSTEM_PROMPT,
} from "@/lib/outreach-campaign-intro-prompt";

export type CampaignIntroEvidence = {
  company: string;
  town: string;
  county: string;
  segment_label: string;
  website: string;
  matched_signals: string;
  google_rating: string;
  google_reviews: string;
  [key: string]: string;
};

type CampaignIntroModelOutput = {
  intro: string;
  used: string[];
};

function value(data: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const text = String(data[key] ?? "").trim();
    if (text) return text;
  }
  return "";
}

function host(value: string) {
  if (!value) return "";
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.replace(/^www\./i, "");
  } catch {
    return value.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0];
  }
}

export function campaignIntroEvidence(
  data: Record<string, unknown>,
  fieldConfig: { companyField?: string | null; countryField?: string | null; segmentField?: string | null } = {},
): CampaignIntroEvidence {
  const company = value(data, [fieldConfig.companyField ?? "", "company", "company_name", "business_name"]);
  const town = value(data, ["town", "city", "locality"]);
  const county = value(data, ["county", "region", "state"]);
  const segment = value(data, [fieldConfig.segmentField ?? "", "segment", "segment_name"]);
  const signals = Object.entries(data)
    .filter(([key, raw]) => /signal|note|evidence/i.test(key) && typeof raw === "string")
    .map(([key, raw]) => `${key}: ${String(raw).trim()}`)
    .filter((item) => item.length > 0)
    .join("; ")
    .slice(0, 300);
  return {
    company,
    town,
    county,
    segment_label: segment.replace(/_/g, " ").trim(),
    website: host(value(data, ["website", "url", "domain"])),
    matched_signals: signals,
    google_rating: value(data, ["google_rating"]),
    google_reviews: value(data, ["google_reviews"]),
  };
}

export function guardCampaignIntro(
  intro: string,
  evidence: CampaignIntroEvidence,
  used: readonly string[] = [],
): string {
  const clean = stripEmDashes(intro).trim();
  if (!clean || clean.length > OUTREACH_INTRO_MAX_CHARS) return "";
  if ((clean.match(/[.!?]+/g) ?? []).length > 2) return "";
  if (/[!?]/.test(clean)) return "";
  const evidenceNumbers = new Set(Object.values(evidence).flatMap((value) => value.match(/\d+(?:\.\d+)?/g) ?? []));
  for (const number of clean.match(/\d+(?:\.\d+)?/g) ?? []) {
    if (!evidenceNumbers.has(number)) return "";
  }
  if (!used.length || used.some((key) => !Object.hasOwn(evidence, key) || !evidence[key])) return "";
  const tokens = (value: string) => (value.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [])
    .map((token) => token.endsWith("'s") ? token.slice(0, -2) : token);
  const evidenceWords = new Set(Object.values(evidence).flatMap((value) => tokens(value)));
  const allowedWords = new Set([
    ...OUTREACH_INTRO_COMMON_WORDS,
    ...evidenceWords,
  ]);
  if (tokens(clean).some((token) => !allowedWords.has(token))) return "";
  return clean;
}

export type CampaignIntroLlm = {
  generate?: (input: { evidence: CampaignIntroEvidence; pitch: string }) => Promise<string | CampaignIntroModelOutput>;
  messages?: {
    create: (params: {
      model: string;
      max_tokens: number;
      system: string;
      messages: Array<{ role: "user"; content: string }>;
    }) => Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
};

export async function generateCampaignIntro(input: {
  evidence: CampaignIntroEvidence;
  pitch: string;
  llm?: CampaignIntroLlm;
}): Promise<string> {
  const fallbackGenerate: NonNullable<CampaignIntroLlm["generate"]> = async ({ evidence, pitch }) => {
    if (input.llm?.messages) {
      const response = await input.llm.messages.create({
        model: "gpt-5.6",
        max_tokens: 180,
        system: OUTREACH_INTRO_SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: `EVIDENCE\n${JSON.stringify(evidence)}\n\nPITCH\n${pitch}`,
        }],
      });
      const text = response.content.find((block) => block.type === "text")?.text ?? "";
      try {
        const parsed = JSON.parse(text) as { intro?: unknown; used?: unknown };
        return {
          intro: typeof parsed.intro === "string" ? parsed.intro : "",
          used: Array.isArray(parsed.used) ? parsed.used.filter((key): key is string => typeof key === "string") : [],
        };
      } catch {
        return "";
      }
    }
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return "";
    const client = new Gpt56Client({ apiKey });
    const response = await client.messages.create({
      model: "gpt-5.6",
      max_tokens: 180,
      system: OUTREACH_INTRO_SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: `EVIDENCE\n${JSON.stringify(evidence)}\n\nPITCH\n${pitch}`,
      }],
    });
    const text = response.content.find((block) => block.type === "text")?.text ?? "";
    try {
    const parsed = JSON.parse(text) as { intro?: unknown; used?: unknown };
      return {
        intro: typeof parsed.intro === "string" ? parsed.intro : "",
        used: Array.isArray(parsed.used) ? parsed.used.filter((key): key is string => typeof key === "string") : [],
      };
    } catch {
      return "";
    }
  };
  const generate = input.llm?.generate ?? fallbackGenerate;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<string>((resolve) => {
      timeout = setTimeout(() => resolve(""), 12_000);
    });
    const raw = await Promise.race([
      generate({ evidence: input.evidence, pitch: input.pitch }),
      timeoutPromise,
    ]);
    const output: CampaignIntroModelOutput = typeof raw === "string"
      ? { intro: raw, used: [] }
      : raw;
    return guardCampaignIntro(output.intro, input.evidence, output.used);
  } catch {
    return "";
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
