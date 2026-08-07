import type { SupplyCompanyResearch } from "@/lib/supply-os-case-model";
import type { SupplyResearchProgress } from "@/lib/supply-os-company-research";

type ResearchStreamEvent =
  | { type: "progress"; event: SupplyResearchProgress }
  | { type: "result"; research: SupplyCompanyResearch }
  | { type: "error"; code: string; message: string };

export const SUPPLY_RESEARCH_PROGRESS_EVENT = "derya:supply-research-progress";
const RESEARCH_REQUEST_TIMEOUT_MS = 12_000;

function publishProgress(event: SupplyResearchProgress) {
  window.dispatchEvent(new CustomEvent<SupplyResearchProgress>(SUPPLY_RESEARCH_PROGRESS_EVENT, { detail: event }));
}

function parseEvent(line: string): ResearchStreamEvent | null {
  try {
    const value = JSON.parse(line) as ResearchStreamEvent;
    return value && typeof value === "object" && typeof value.type === "string" ? value : null;
  } catch {
    return null;
  }
}

export async function requestCompanyResearch(query: string): Promise<SupplyCompanyResearch> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), RESEARCH_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await window.fetch("/api/supply-os/company-research", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
  } catch (error) {
    window.clearTimeout(timeout);
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Company research took too long to finish.");
    }
    throw error;
  }
  if (!response.ok) {
    window.clearTimeout(timeout);
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || "Company research failed.");
  }
  if (!response.headers.get("content-type")?.includes("application/x-ndjson") || !response.body) {
    window.clearTimeout(timeout);
    const body = await response.json().catch(() => null) as { research?: SupplyCompanyResearch; error?: string } | null;
    if (!body?.research) throw new Error(body?.error || "Company research failed.");
    return body.research;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: SupplyCompanyResearch | null = null;
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const event = parseEvent(line);
        if (event?.type === "progress") publishProgress(event.event);
        if (event?.type === "result") result = event.research;
        if (event?.type === "error") throw new Error(event.message || "Company research failed.");
      }
      if (chunk.done) break;
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Company research took too long to finish.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
  const finalEvent = parseEvent(buffer);
  if (finalEvent?.type === "progress") publishProgress(finalEvent.event);
  if (finalEvent?.type === "result") result = finalEvent.research;
  if (finalEvent?.type === "error") throw new Error(finalEvent.message || "Company research failed.");
  if (!result) throw new Error("Company research ended without a dashboard result.");
  return result;
}
