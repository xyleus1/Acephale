import Ajv2020 from "ajv/dist/2020";
import { hash } from "../../src/lib/acephale/canonical";
import type { Candidate, ExecutionFrame, Invocation } from "../../src/lib/acephale/contracts/generated";
import type { FrozenExperienceMemory } from "../../src/lib/acephale/experience-memory";
import { compileInfraWorkflows } from "../../src/lib/acephale/infra-workflows";
import { nativeCandidateGraphV5 } from "./native-candidate-graph";

/** Graph candidates retain their IDs and exact bindings when workflows propose duplicates. */
export function mergeInfraNativeCandidates(graph: Candidate[], workflows: Candidate[], eligible: (invocation: Invocation) => boolean): Candidate[] {
  const seen = new Set<string>();
  // Deduplicate before interleaving so graph bindings win even when their lane is visited later.
  const lanes = [graph, workflows].map(source => {
    const tools = new Map<string, Candidate[]>();
    for (const candidate of source) {
      const key = hash(candidate.invocation);
      if (seen.has(key) || !eligible(candidate.invocation)) continue;
      seen.add(key);
      const lane = tools.get(candidate.invocation.tool) ?? [];
      lane.push(candidate); tools.set(candidate.invocation.tool, lane);
    }
    return [...tools.values()];
  });
  const positions = [0, 0], pool: Candidate[] = [];
  while (pool.length < 128 && lanes.some(source => source.length)) {
    for (let source = 0; source < lanes.length && pool.length < 128; source++) {
      const tools = lanes[source]; if (!tools.length) continue;
      const index = positions[source] % tools.length;
      pool.push(tools[index].shift()!);
      if (!tools[index].length) { tools.splice(index, 1); positions[source] = index; }
      else positions[source] = index + 1;
    }
  }
  return pool;
}

/** One candidate universe implementation serves frozen replay and live native runs. */
export function createInfraNativeCandidates(memory: FrozenExperienceMemory, tools: Record<string, Record<string, unknown>>,
  eligible: (invocation: Invocation) => boolean, options: { allowedFamilies?: string[]; excludeFamilies?: string[] } = {}) {
  const workflows = compileInfraWorkflows(memory, tools, options);
  const ajv = new Ajv2020({ strict: false });
  const validators = new Map(Object.entries(tools).map(([tool, schema]) => [tool, ajv.compile(schema)]));
  const valid = (invocation: Invocation) => !!validators.get(invocation.tool)?.(invocation.arguments) && eligible(invocation);
  const cached = new WeakMap<ExecutionFrame, Candidate[]>();
  return { workflowHash: workflows.contentHash, patternCount: workflows.records.length,
    candidates(frame: ExecutionFrame): Candidate[] {
      const previous = cached.get(frame);
      if (previous) return previous;
      const candidates = mergeInfraNativeCandidates(nativeCandidateGraphV5(frame, tools, valid), workflows.bind(frame), valid);
      cached.set(frame, candidates); return candidates;
    },
  };
}
