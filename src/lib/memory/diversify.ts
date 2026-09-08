import type { HybridMemorySearchResult } from "./retrievers/types";

function emailThreadGroup(result: HybridMemorySearchResult) {
  if (result.emailThreadId) return result.emailThreadId;
  if (result.canonicalType === "email_thread") return result.entityId ?? result.objectId;
  if (result.entityType === "email_thread") return result.entityId;
  return null;
}

/**
 * Keeps a single conversation from crowding out independent evidence. Results
 * without a proven thread link are never grouped by subject or participants.
 */
export function diversifyMemoryResults(
  results: HybridMemorySearchResult[],
  options: { limit: number; maxPerEmailThread?: number },
) {
  const limit = Math.max(1, Math.floor(options.limit));
  const cap = Math.max(
    1,
    Math.min(limit, Math.floor(options.maxPerEmailThread ?? Math.max(1, Math.ceil(limit / 3)))),
  );
  const threadCounts = new Map<string, number>();
  const diversified: HybridMemorySearchResult[] = [];

  for (const result of results) {
    if (diversified.length >= limit) break;
    const threadId = emailThreadGroup(result);
    if (!threadId) {
      diversified.push(result);
      continue;
    }
    const count = threadCounts.get(threadId) ?? 0;
    if (count >= cap) continue;
    threadCounts.set(threadId, count + 1);
    diversified.push(result);
  }

  return diversified;
}
