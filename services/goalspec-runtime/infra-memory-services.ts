import type { PrismaClient } from "@prisma/client";
import { readFile } from "node:fs/promises";
import type { BudgetLedger, Allocation } from "../../src/lib/goalspec/budget";
import { validateMemoryArtifact, type FrozenExperienceMemory } from "../../src/lib/goalspec/experience-memory";
import { createEpisodicRetriever, episodicRetrievalProfileHash, validateEpisodeEmbeddings, type FrozenEpisodeEmbeddings, type EpisodicSearchPort } from "../../src/lib/goalspec/episodic-retrieval";
import { postgresEpisodicSearch } from "../../src/lib/goalspec/episodic-postgres";
import { researchDatabase } from "../../src/lib/goalspec/postgres-store";
import { researchProvider } from "./provider";

export async function loadFrozenEpisodeEmbeddings(path: string, memory: FrozenExperienceMemory) {
  return validateEpisodeEmbeddings(JSON.parse(await readFile(path, "utf8")), memory);
}
/** One DB connection owner, injected existing spending owner, isolated per-run caches. */
export function createInfraMemoryServices(options: {
  memory: FrozenExperienceMemory; embeddings: FrozenEpisodeEmbeddings;
  databaseUrl?: string; applicationDatabaseUrl?: string; database?: PrismaClient;
  budget: BudgetLedger; allocation: Allocation;
  budgetForRun?: (runId: string) => { ledger: BudgetLedger; allocation: Allocation };
  allowedFamilies: string[]; excludeFamilies?: string[]; timeoutMs?: number;
  record?: (event: Record<string, unknown>) => void;
  /** Explicit dependency injection for deterministic tests and offline replay. */
  embed?: (text: string, signal: AbortSignal, runId: string) => Promise<number[]>;
  search?: EpisodicSearchPort;
}) {
  if (["infrastructure", "contingency"].includes(options.allocation)) throw new Error("Embedding calls cannot spend protected allocations");
  const memory = validateMemoryArtifact(options.memory), embeddings = validateEpisodeEmbeddings(options.embeddings, memory);
  const db = options.database ?? (options.databaseUrl ? researchDatabase(options.databaseUrl, options.applicationDatabaseUrl) : undefined);
  if (!db && !options.search) throw new Error("Dedicated research database required for episodic retrieval");
  const search = options.search ?? postgresEpisodicSearch(db!);
  const pending = new Set<Promise<unknown>>(), runs = new Map<string, ReturnType<typeof createEpisodicRetriever>>();
  let closing = false, closed = false, closingTask: Promise<void> | undefined;
  const record = (event: Record<string, unknown>) => { if (!closed) options.record?.(event); };
  const track = <T>(operation: Promise<T>) => {
    pending.add(operation); void operation.then(() => pending.delete(operation), () => pending.delete(operation)); return operation;
  };
  function perRun(runId: string, arm: "base" | "neutral_memory_prefetch" | "goalspec", familyId: string) {
    if (closing || !runId || !familyId || runs.has(runId)) throw new Error("Invalid or repeated retrieval run");
    if (arm === "base") return undefined;
    const budget = options.budgetForRun?.(runId) ?? { ledger: options.budget, allocation: options.allocation };
    if (["infrastructure", "contingency"].includes(budget.allocation)) throw new Error("Embedding calls cannot spend protected allocations");
    const provider = options.embed ? undefined : researchProvider(budget.ledger, budget.allocation,
      event => record({ ...(event as Record<string, unknown>), runId, arm }));
    const retriever = createEpisodicRetriever({ memory, embeddings, allowedFamilies: options.allowedFamilies,
      excludeFamilies: [...new Set([...(options.excludeFamilies ?? []), familyId])], timeoutMs: options.timeoutMs,
      embed: (text, signal) => {
        if (closing) return Promise.reject(new Error("Memory services closing"));
        return track(options.embed ? options.embed(text, signal, runId) : provider!.embed(text, signal));
      }, search: (request, signal) => track(search(request, signal)), record: event => record({ ...event, runId, arm }) });
    const managed = { ...retriever, retrieve: (frame: Parameters<typeof retriever.retrieve>[0], signal: AbortSignal) => track(retriever.retrieve(frame, signal)) };
    runs.set(runId, managed); return managed;
  }
  return { perRun, profileHash: episodicRetrievalProfileHash(embeddings, options.timeoutMs), async drain() { while (pending.size) await Promise.allSettled([...pending]); },
    close() {
      if (closingTask) return closingTask;
      closing = true; runs.forEach(run => run.close());
      closingTask = (async () => {
        while (pending.size) await Promise.allSettled([...pending]);
        if (db && !options.database) await db.$disconnect();
        closed = true;
      })();
      return closingTask;
    } };
}
