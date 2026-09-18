import { copy, hash } from "./canonical";
import type { ExecutionFrame, WorkflowPattern } from "./contracts/generated";
import { validateContract } from "./contracts/validate";

export interface Experience { id: string; familyId: string; text: string; embedding: number[]; pattern: WorkflowPattern; split: "train" | "development" | "test" }
export interface ExperienceRepository {
  retrieve(frame: ExecutionFrame, query: string, embedding: number[], limit: number): Promise<Experience[]>;
  retrieveLocal?(frame: ExecutionFrame, query: string, limit: number): Experience[];
}

function cosine(a: number[], b: number[]) {
  if (a.length !== 1536 || b.length !== 1536 || [...a, ...b].some(v => !Number.isFinite(v))) throw new Error("Expected finite 1536-dimensional embeddings");
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

export class FrozenRepository implements ExperienceRepository {
  private rows: Experience[];
  readonly digest: string;
  constructor(readonly snapshotId: string, records: Experience[], heldoutFamilies: string[] = []) {
    if (!snapshotId || new Set(records.map(r => r.id)).size !== records.length) throw new Error("Invalid snapshot");
    for (const r of records) {
      validateContract("WorkflowPattern", r.pattern);
      if (r.split !== "train" || heldoutFamilies.includes(r.familyId) || r.pattern.snapshotId !== snapshotId) throw new Error("Snapshot contamination");
      cosine(r.embedding, r.embedding);
    }
    this.rows = copy(records); this.digest = hash(this.rows);
  }
  async retrieve(frame: ExecutionFrame, query: string, embedding: number[], limit = 8) {
    if (frame.snapshotId !== this.snapshotId) throw new Error("Frozen snapshot mismatch");
    const words = new Set(query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []);
    return this.rows.filter(r => hash(r.pattern.scope) === hash(frame.scope) && r.pattern.verificationTier === "native_verified")
      .map(r => ({ r, score: cosine(embedding, r.embedding) + [...words].filter(w => r.text.toLowerCase().includes(w)).length / Math.max(1, words.size) }))
      .sort((a, b) => b.score - a.score || a.r.id.localeCompare(b.r.id)).slice(0, Math.max(0, Math.min(32, limit))).map(({ r }) => copy(r));
  }
  retrieveLocal(frame: ExecutionFrame, query: string, limit = 8) {
    if (frame.snapshotId !== this.snapshotId) throw new Error("Frozen snapshot mismatch");
    const words = new Set(query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []);
    return this.rows.filter(r => hash(r.pattern.scope) === hash(frame.scope) && r.pattern.verificationTier === "native_verified")
      .map(r => ({ r, score: [...words].filter(w => r.text.toLowerCase().includes(w)).length }))
      .sort((a, b) => b.score - a.score || a.r.id.localeCompare(b.r.id)).slice(0, Math.max(0, Math.min(32, limit))).map(({ r }) => copy(r));
  }
}
