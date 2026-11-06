import Ajv2020 from "ajv/dist/2020";
import { hash } from "../../src/lib/goalspec/canonical";
import type { Candidate, ExecutionFrame, Invocation } from "../../src/lib/goalspec/contracts/generated";
import type { FrozenExperienceMemory } from "../../src/lib/goalspec/experience-memory";
import { compileInfraWorkflows } from "../../src/lib/goalspec/infra-workflows";
import { nativeCandidateGraphV5 } from "./native-candidate-graph";

/** Graph candidates retain their IDs and exact bindings when workflows propose duplicates. */
export function mergeInfraNativeCandidates(graph: Candidate[], workflows: Candidate[], eligible: (invocation: Invocation) => boolean): Candidate[] {
  const pool = new Map<string, Candidate>();
  for (const candidate of [...graph, ...workflows]) {
    const key = hash(candidate.invocation);
    if (pool.size < 128 && !pool.has(key) && eligible(candidate.invocation)) pool.set(key, candidate);
  }
  return [...pool.values()];
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
