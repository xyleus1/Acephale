import type { WorkflowPattern } from "./contracts/generated";

/** A frozen symbolic workflow and its training provenance. */
export interface Experience { id: string; familyId: string; text: string; embedding: number[]; pattern: WorkflowPattern; split: "train" | "development" | "test" }
