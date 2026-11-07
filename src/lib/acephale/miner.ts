import { canonical, hash } from "./canonical";
import { frequentContexts, inferBinding, resolveBinding, type ArgumentBinding, type BindingEvent } from "./patterns";

export interface MiningPrefix { events: BindingEvent[]; throughSeq: number; signatures: string[]; tools: { name: string; parameters: Record<string, unknown> }[] }
export interface MiningEpisode {
  id: string; family: string; benchmark: string; domain: string; canonicalGoalId: string | null;
  verifiedSuccess: boolean; checkpoints: { prefix: MiningPrefix; targets: { tool: string; arguments: Record<string, unknown> }[] }[];
}
export interface MinedPattern {
  pattern_id: string; benchmark: string; domain: string; goal_id: string | null; context: string[]; tool: string;
  support: number; context_support: number; observations: number; context_observations: number; probability: number;
  binding: ArgumentBinding | null;
}
type Occurrence = { prefix: MiningPrefix; targets: MiningEpisode["checkpoints"][number]["targets"]; family: string };

// Python prepares causal checkpoints and independent canonical endpoint labels.
// Counts and binding learning are shared TypeScript runtime primitives.
export function minePatterns(episodes: MiningEpisode[], maxContext = 3, minSupport = 2, maxHistory = 12, smoothing = 0.5): MinedPattern[] {
  if (new Set(episodes.map(e => e.id)).size !== episodes.length || !Number.isInteger(maxHistory) || maxHistory < 1 || maxHistory > 32 || !Number.isFinite(smoothing) || smoothing <= 0) throw new Error("Invalid miner input");
  frequentContexts([], [], maxContext, minSupport);
  const scopes = new Map<string, { scope: [string, string, string | null]; rows: Occurrence[] }>();
  const vocabulary = new Map<string, Set<string>>();
  for (const episode of episodes) {
    if (!episode.verifiedSuccess) continue;
    const domainKey = canonical([episode.benchmark, episode.domain]);
    const words = vocabulary.get(domainKey) ?? new Set<string>();
    vocabulary.set(domainKey, words);
    for (const checkpoint of [...episode.checkpoints].reverse()) {
      if (checkpoint.prefix.events.some(e => e.seq > checkpoint.prefix.throughSeq)) throw new Error("Future event in mining prefix");
      checkpoint.targets.forEach(t => words.add(t.tool));
      for (const goal of episode.canonicalGoalId ? [null, episode.canonicalGoalId] : [null]) {
        const scope: [string, string, string | null] = [episode.benchmark, episode.domain, goal];
        const key = canonical(scope);
        const group = scopes.get(key) ?? { scope, rows: [] };
        group.rows.push({ ...checkpoint, family: episode.family }); scopes.set(key, group);
      }
    }
  }
  const patterns: { key: unknown[]; pattern: MinedPattern }[] = [];
  for (const { scope, rows } of scopes.values()) {
    const contexts = frequentContexts(rows.map(r => r.prefix.signatures.slice(-maxHistory)), rows.map(r => r.family), maxContext, minSupport);
    for (const [context, indexes] of contexts) {
      const samples = new Map<string, { prefix: MiningPrefix; arguments: Record<string, unknown>; family: string }[]>();
      const contextFamilies = new Set<string>(); let total = 0;
      for (const index of indexes) for (const target of rows[index].targets) {
        const sample = { prefix: rows[index].prefix, arguments: target.arguments, family: rows[index].family };
        const collected = samples.get(target.tool) ?? []; collected.push(sample); samples.set(target.tool, collected);
        contextFamilies.add(sample.family); total++;
      }
      if (contextFamilies.size < minSupport) continue;
      for (const [tool, examples] of samples) {
        const support = new Set(examples.map(e => e.family)).size;
        let binding: ArgumentBinding | null = null;
        const schemas = examples.map(e => e.prefix.tools.find(t => t.name === tool)?.parameters);
        if (support >= Math.max(2, minSupport) && schemas[0] && schemas.every(s => s && canonical(s) === canonical(schemas[0]))) {
          binding = inferBinding(examples.map(e => ({ ...e.prefix, arguments: e.arguments })), schemas[0], minSupport) ?? null;
          if (binding) {
            const expression = binding.expression;
            const families = new Set(examples.filter(e => {
              try { return canonical(resolveBinding(expression, e.prefix.events, e.prefix.throughSeq)) === canonical(e.arguments); } catch { return false; }
            }).map(e => e.family));
            if (families.size < Math.max(2, minSupport)) binding = null;
          }
        }
        const key = [...scope, context, tool];
        const vocabularySize = vocabulary.get(canonical(scope.slice(0, 2)))!.size;
        patterns.push({ key, pattern: { pattern_id: "pattern_" + hash(key).slice(0, 20), benchmark: scope[0], domain: scope[1], goal_id: scope[2], context, tool,
          support, context_support: contextFamilies.size, observations: examples.length, context_observations: total,
          probability: (examples.length + smoothing) / (total + smoothing * vocabularySize), binding } });
      }
    }
  }
  return patterns.sort((a, b) => canonical(a.key) < canonical(b.key) ? -1 : 1).map(p => p.pattern);
}

// Select the structural context once, without goal access, to avoid the earlier
// conditioning-pool confound. Each goal ranks an identical bound candidate union.
export function selectContext(patterns: MinedPattern[], signatures: string[], benchmark: string, domain: string) {
  const contexts = new Set(frequentContexts([signatures.slice(-12)], ["query"], 3, 1).map(([c]) => canonical(c)));
  const eligible = patterns.filter(p => p.benchmark === benchmark && p.domain === domain && p.goal_id === null && contexts.has(canonical(p.context)));
  eligible.sort((a, b) => b.context.length - a.context.length || b.context_support - a.context_support || b.context_observations - a.context_observations || (canonical(a.context) < canonical(b.context) ? 1 : -1));
  return eligible[0]?.context;
}
