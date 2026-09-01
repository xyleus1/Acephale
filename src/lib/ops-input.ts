import { normalizeDedupeValue } from "@/lib/research-dedupe";
import type { ResearchField } from "@/lib/research-lists";

export function boundedText(value: unknown, max: number): string | undefined {
  return typeof value === "string" ? value.trim().slice(0, max) : undefined;
}

export async function readBoundedText(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

export function isOverLength(value: unknown, max: number): boolean {
  return typeof value === "string" && value.trim().length > max;
}

export function resolveDedupeField(fields: ResearchField[], dedupeField: string): ResearchField {
  const field = fields.find((item) => item.key === dedupeField);
  if (!field) throw new Error("Dedupe field is not in the list definition.");
  return field;
}

export function missingDedupeRows(rows: unknown[], fieldKey: string): number[] {
  return rows
    .map((row, index) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return index;
      const value = (row as Record<string, unknown>)[fieldKey];
      return value === null || value === undefined || normalizeDedupeValue(value) === null
        ? index
        : null;
    })
    .filter((index): index is number => index !== null)
    .slice(0, 50);
}
