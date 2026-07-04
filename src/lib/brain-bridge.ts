import "server-only";
import { z } from "zod";

// Read-only client for the Derya Brain bridge on the derya-brain-runtime
// Render service (see BRAIN_BRIDGE_RUNBOOK.md in derya-ai-workspace).
// Product truth always wins over bridge context. This module never throws:
// missing config falls back to deterministic mock sections, and any live
// failure returns an error-state result the panel can render honestly.

const brainBridgeSectionSchema = z.object({
  key: z.enum(["customer", "lane", "provider", "sop", "web_intel"]),
  status: z.enum(["ready", "proposed_only", "no_context_found", "timeout", "unavailable"]),
  summary: z.string(),
  confidence: z.enum(["high", "medium", "low", "proposed", "missing"]),
  freshness: z.enum(["current", "stale", "needs_recheck", "unknown"]),
  sourceSlugs: z.array(z.string()),
  sourceUrls: z.array(z.string()),
  suggestedNextAction: z.string().nullable(),
  missingEvidence: z.array(z.string()),
  ms: z.number().nullable(),
});

const brainBridgeResponseSchema = z.object({
  ok: z.literal(true),
  rfqId: z.string(),
  generatedAt: z.string(),
  totalMs: z.number(),
  sections: z.array(brainBridgeSectionSchema),
});

export type BrainBridgeSection = z.infer<typeof brainBridgeSectionSchema>;

export type BrainBridgeResult = {
  mode: "live" | "mock" | "disabled" | "error";
  generatedAt: string | null;
  sections: BrainBridgeSection[];
  note: string;
};

export type BrainBridgeInput = {
  officeId: string;
  rfqId: string;
  customerName?: string;
  fromEmail?: string;
  origin?: string;
  destination?: string;
  mode?: string;
  equipmentType?: string;
  commodity?: string;
};

function bridgeConfig() {
  return {
    url: (process.env.BRAIN_BRIDGE_URL ?? "").trim().replace(/\/$/, ""),
    token: (process.env.BRAIN_BRIDGE_TOKEN ?? "").trim(),
    modeOverride: (process.env.BRAIN_BRIDGE_MODE ?? "").trim().toLowerCase(),
    timeoutMs: Number(process.env.BRAIN_BRIDGE_TIMEOUT_MS) || 12000,
  };
}

function timeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, done: () => clearTimeout(timeout) };
}

const MOCK_SECTION_SEEDS: Array<{ key: BrainBridgeSection["key"]; summary: string; slug: string }> = [
  { key: "customer", summary: "Mock customer context: no live GBrain connection configured.", slug: "mock/customer-context-sample" },
  { key: "lane", summary: "Mock lane context: connect the brain bridge to see lane history and baselines.", slug: "mock/lane-context-sample" },
  { key: "provider", summary: "Mock provider context: rate-provider landscape appears here when live.", slug: "mock/provider-landscape-sample" },
  { key: "sop", summary: "Mock SOP context: RFQ required-field and quote-flow pages appear here when live.", slug: "mock/sop-sample" },
  { key: "web_intel", summary: "Mock web intelligence: proposed external context appears here when live.", slug: "mock/web-intel-sample" },
];

export function mockBrainBridgeSections(): BrainBridgeSection[] {
  return MOCK_SECTION_SEEDS.map((seed) => ({
    key: seed.key,
    status: "ready",
    summary: seed.summary,
    confidence: "low",
    freshness: "unknown",
    sourceSlugs: [seed.slug],
    sourceUrls: [],
    suggestedNextAction: "Set BRAIN_BRIDGE_URL and BRAIN_BRIDGE_TOKEN to enable live GBrain context.",
    missingEvidence: ["live brain bridge connection"],
    ms: null,
  }));
}

export async function getBrainBridgeContext(input: BrainBridgeInput): Promise<BrainBridgeResult> {
  const config = bridgeConfig();

  if (config.modeOverride === "off") {
    return { mode: "disabled", generatedAt: null, sections: [], note: "Brain bridge is disabled (BRAIN_BRIDGE_MODE=off)." };
  }

  const liveConfigured = Boolean(config.url && config.token.length >= 16);
  if (config.modeOverride === "mock" || !liveConfigured) {
    return {
      mode: "mock",
      generatedAt: new Date().toISOString(),
      sections: mockBrainBridgeSections(),
      note: "Mock mode — deterministic sample sections, no network calls, no live Derya memory.",
    };
  }

  const { signal, done } = timeoutSignal(config.timeoutMs);
  try {
    const res = await fetch(`${config.url}/brain-context`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
      cache: "no-store",
      signal,
    });
    if (!res.ok) {
      return {
        mode: "error",
        generatedAt: null,
        sections: [],
        note: `Brain bridge responded ${res.status}. RFQ/product truth is unaffected.`,
      };
    }
    const parsed = brainBridgeResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      return {
        mode: "error",
        generatedAt: null,
        sections: [],
        note: "Brain bridge returned an unexpected shape. RFQ/product truth is unaffected.",
      };
    }
    return {
      mode: "live",
      generatedAt: parsed.data.generatedAt,
      sections: parsed.data.sections,
      note: `Live GBrain retrieval in ${parsed.data.totalMs}ms.`,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      mode: "error",
      generatedAt: null,
      sections: [],
      note: aborted
        ? `Brain bridge timed out after ${config.timeoutMs}ms. RFQ/product truth is unaffected.`
        : "Brain bridge is unreachable. RFQ/product truth is unaffected.",
    };
  } finally {
    done();
  }
}
