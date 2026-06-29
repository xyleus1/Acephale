export const BRAIN_SOURCE_TYPES = [
  "meeting_note",
  "granola_meeting_note",
  "email",
  "call_note",
  "proposal",
  "contract",
  "memo",
  "product_doc",
  "support_ticket",
  "research",
  "manual_note",
  "other",
] as const;

export const BRAIN_DOCUMENT_STATUSES = ["current-state", "plan", "brainstorm", "report", "archived", "unknown"] as const;
export const BRAIN_REVIEW_STATUSES = ["pending", "approved", "rejected", "applied"] as const;
export const BRAIN_DECISION_STATUSES = ["proposed", "active", "superseded", "rejected"] as const;

export type BrainSourceType = typeof BRAIN_SOURCE_TYPES[number];
export type BrainMode = "calibration" | "trusted";
export type BrainProposalType =
  | "organization"
  | "person"
  | "interaction"
  | "commitment"
  | "decision"
  | "risk"
  | "open_question"
  | "document";

export type BrainOperationalReferencePayload = {
  type?: "company" | "contact" | "inquiry" | "job" | "email_thread" | "email_message" | "job_document" | "strategy_assessment" | string;
  id?: string;
  name?: string;
  email?: string;
  reference?: string;
  subject?: string;
  external_id?: string;
};

export type BrainSourcePayload = {
  title?: string;
  source_type?: BrainSourceType | string;
  source_uri?: string;
  occurred_at?: string;
  raw_text?: string;
};

type BaseProposedRecord = {
  source_quote?: string;
  confidence?: number;
  manually_entered?: boolean;
};

export type BrainIngestPayload = {
  mode?: BrainMode;
  source?: BrainSourcePayload;
  operational_refs?: BrainOperationalReferencePayload[];
  organizations?: Array<BaseProposedRecord & { name?: string; type?: string; notes?: string }>;
  people?: Array<BaseProposedRecord & { name?: string; email?: string; title?: string; organization_name?: string }>;
  interactions?: Array<BaseProposedRecord & { organization_name?: string; occurred_at?: string; interaction_type?: string; summary?: string }>;
  commitments?: Array<BaseProposedRecord & { organization_name?: string; owner_text?: string; description?: string; due_date?: string }>;
  decisions?: Array<BaseProposedRecord & { title?: string; summary?: string; decision_date?: string; owner_text?: string }>;
  risks?: Array<BaseProposedRecord & { organization_name?: string; description?: string; severity?: string }>;
  open_questions?: Array<BaseProposedRecord & { organization_name?: string; question?: string; owner_text?: string }>;
  documents?: Array<BaseProposedRecord & { organization_name?: string; title?: string; status?: string; summary?: string }>;
};

export type BrainIngestWarning = {
  path: string;
  message: string;
};

export type BrainIngestRejectedItem = BrainIngestWarning & {
  payload?: unknown;
};

export type BrainIngestResult = {
  ok: boolean;
  mode: BrainMode;
  sourceObjectId?: string;
  batchProposalId?: string;
  proposalIds: string[];
  createdRecords: Array<{ type: string; id: string }>;
  unresolvedEntities: Array<{ type: string; name: string; path: string }>;
  resolvedOperationalRefs?: Array<{ type: string; id: string; label: string; path: string }>;
  rejectedItems: BrainIngestRejectedItem[];
  warnings: BrainIngestWarning[];
};

export type BrainFactSource = {
  id: string;
  title: string | null;
  source_type: string;
  occurred_at: string;
  source_uri: string | null;
};

export type BrainFact = {
  claim: string;
  source: BrainFactSource;
  quote: string | null;
  confidence: number | null;
};
