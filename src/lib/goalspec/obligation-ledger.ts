import { canonical, copy, hash } from "./canonical";
import type { ExecutionFrame, GoalSet, SourceRef } from "./contracts/generated";
import { validateContract } from "./contracts/validate";

export const OBLIGATION_LEDGER_VERSION = "goalspec-obligations-v5";
const MAX_REQUESTS = 96;
const MAX_QUOTES = 2_048;
const MAX_RECEIPTS = 96;
const requestSource = (id: string) => id === "current_user_request" || /^(requirement|request):\d+$/.test(id);
const clockSource = (id: string) => /^(current_date|current_time|today|timezone|date_context)$/.test(id);

/** A quotation proves its origin, not its completeness, meaning or permission. */
export interface LiteralSourceSpan { source: SourceRef; sourceHash: string; start: number; end: number; quote: string }
export interface RequestStatement {
  id: string; evidence: LiteralSourceSpan; truncated: boolean;
  state: "latest_user_statement" | "earlier_user_statement";
  observedLanguage: "affirmative_text" | "negative_text" | "other_text";
  containsNativeStop: boolean;
}
export interface LiteralQualifier {
  kind: "minimum" | "maximum" | "exclusion" | "route" | "date" | "selection";
  evidence: LiteralSourceSpan;
}
export interface ObservedReceipt {
  callId: string; tool: string; state: "tool_response_observed";
  toolReportedStatus: "success" | "error"; requestSource: SourceRef; responseSource: SourceRef;
  argumentsHash: string; observationHash: string;
}
export interface ObligationLedger {
  version: typeof OBLIGATION_LEDGER_VERSION; runId: string; snapshotId: string; scopeHash: string;
  boundary: number; requestRevisionHash: string; policyHash: string; stateHash: string;
  statements: RequestStatement[]; qualifiers: LiteralQualifier[]; receipts: ObservedReceipt[];
  sourceHashes: Record<string, string>; omittedStatements: number; omittedReceipts: number;
  invalidReceiptEvents: number; ungroundedRequestedObjective: boolean;
  sourceChanges: { changed: string[]; removed: string[] };
  semanticStatus: "literal_projection_only";
}
export interface HypothesisExposure {
  mode: "experimental"; requestRevisionHash: string; goals: GoalSet;
}
export interface ObligationContextOptions {
  maxCharacters?: number; hypotheses?: HypothesisExposure;
}
function fail(reason: string): never { throw new Error(`Obligation ledger: ${reason}`); }
function checkLedger(ledger: ObligationLedger) {
  const { stateHash, ...body } = ledger;
  if (ledger.version !== OBLIGATION_LEDGER_VERSION || stateHash !== hash(body)) fail("invalid ledger integrity");
}
function span(sourceId: string, text: string, start = 0, end = Math.min(text.length, MAX_QUOTES)): LiteralSourceSpan {
  return { source: { sourceId, path: [] }, sourceHash: hash(text), start, end, quote: text.slice(start, end) };
}
function language(text: string): RequestStatement["observedLanguage"] {
  if (/^\s*(?:no\b|do not\b|don['\u2019]t\b|not confirmed\b)/i.test(text)) return "negative_text";
  if (/^\s*(?:yes\b|confirmed\b|i confirm\b|please proceed\b)/i.test(text)) return "affirmative_text";
  return "other_text";
}
function qualifiers(sourceId: string, text: string): LiteralQualifier[] {
  const patterns: [LiteralQualifier["kind"], RegExp][] = [
    ["minimum", /\b(?:cheapest|lowest|least expensive|earliest|smallest|minimum|at least)\b/gi],
    ["maximum", /\b(?:highest|latest|largest|maximum|at most|no more than|up to)\b/gi],
    ["exclusion", /\b(?:do not|don['\u2019]t|without|no|not|exclude)\b[^.!?;\n]{0,160}/gi],
    ["route", /\bfrom\s+[^.!?;\n]{1,60}?\s+to\s+[^.!?;\n]{1,60}/gi],
    ["date", /\b(?:tomorrow|today|yesterday|the day after|the day before|next week|next month|\d{4}-\d{2}-\d{2})\b/gi],
    ["selection", /\b(?:only|instead|all|each|both)\b[^.!?;\n]{0,120}/gi],
  ];
  return patterns.flatMap(([kind, pattern]) => [...text.matchAll(pattern)].map(match => ({ kind,
    evidence: span(sourceId, text, match.index!, match.index! + match[0].length) }))).slice(0, 32);
}
function observedReceipts(frame: ExecutionFrame): { receipts: ObservedReceipt[]; invalid: number } {
  const events = frame.sources._binding_events;
  if (!Array.isArray(events)) return { receipts: [], invalid: 0 };
  const requests = new Map<string, { index: number; tool: string; argumentsHash: string }>();
  const seen = new Set<string>();
  const receipts: ObservedReceipt[] = [];
  let invalid = 0;
  for (const [index, value] of events.entries()) {
    if (!value || typeof value !== "object" || Array.isArray(value)) { invalid++; continue; }
    const event = value as Record<string, unknown>;
    if (event.kind !== "tool_request" && event.kind !== "tool_result") continue;
    if (typeof event.call_id !== "string" || !event.call_id || typeof event.tool !== "string" || !event.tool) { invalid++; continue; }
    if (event.kind === "tool_request") {
      if (requests.has(event.call_id) || !event.arguments || typeof event.arguments !== "object" || Array.isArray(event.arguments)) { invalid++; continue; }
      requests.set(event.call_id, { index, tool: event.tool, argumentsHash: hash(event.arguments) });
    } else {
      const request = requests.get(event.call_id);
      if (!request || request.tool !== event.tool || seen.has(event.call_id) || !("result" in event)
        || (event.status !== "success" && event.status !== "error")) { invalid++; continue; }
      seen.add(event.call_id);
      receipts.push({ callId: event.call_id, tool: event.tool, state: "tool_response_observed",
        toolReportedStatus: event.status, argumentsHash: request.argumentsHash, observationHash: hash(event.result),
        requestSource: { sourceId: "_binding_events", path: [request.index] },
        responseSource: { sourceId: "_binding_events", path: [index, "result"] } });
    }
  }
  return { receipts, invalid };
}

/** Rebuild from the current public frame; missing or changed sources never carry forward. */
export function buildObligationLedger(frame: ExecutionFrame, previous?: ObligationLedger): ObligationLedger {
  if (!frame.runId || !frame.snapshotId || !Number.isSafeInteger(frame.boundary) || frame.boundary < 0) fail("invalid frame identity");
  if (previous) {
    checkLedger(previous);
    if (previous.runId !== frame.runId || frame.boundary < previous.boundary) fail("run changed or boundary regressed");
  }
  const sources = Object.entries(frame.sources).filter(([id, value]) => requestSource(id) && typeof value === "string" && value.trim())
    .sort(([a], [b]) => a === "current_user_request" ? 1 : b === "current_user_request" ? -1 : a.localeCompare(b, "en", { numeric: true })) as [string, string][];
  // current_user_request can alias the newest requirement; preserve one span, not two copies.
  if (sources.length > 1 && sources.at(-1)?.[0] === "current_user_request" && sources.at(-1)?.[1] === sources.at(-2)?.[1]) sources.pop();
  const sourceHashes = Object.fromEntries(sources.map(([id, text]) => [id, hash(text)]));
  const clocks = Object.fromEntries(Object.entries(frame.sources).filter(([id]) => clockSource(id)).map(([id, value]) => [id, hash(value)]));
  const scopeHash = hash(frame.scope), policyHash = hash(frame.policy);
  const sameScope = previous?.scopeHash === scopeHash && previous.snapshotId === frame.snapshotId;
  const before = sameScope ? previous.sourceHashes : {};
  const requestRevisionHash = hash({ version: OBLIGATION_LEDGER_VERSION, runId: frame.runId,
    snapshotId: frame.snapshotId, scopeHash, policyHash, sourceHashes, clocks });
  const current = sources.at(-1);
  const statements: RequestStatement[] = sources.slice(-MAX_REQUESTS).map(([id, text]) => ({
    id: hash([id, text]), evidence: span(id, text), truncated: text.length > MAX_QUOTES,
    state: id === current?.[0] ? "latest_user_statement" : "earlier_user_statement",
    observedLanguage: language(text), containsNativeStop: text.includes("###STOP###"),
  }));
  const observed = observedReceipts(frame);
  const body: Omit<ObligationLedger, "stateHash"> = { version: OBLIGATION_LEDGER_VERSION, runId: frame.runId,
    snapshotId: frame.snapshotId, scopeHash, boundary: frame.boundary, requestRevisionHash, policyHash,
    statements, qualifiers: current ? qualifiers(...current) : [], receipts: observed.receipts.slice(-MAX_RECEIPTS),
    sourceHashes, omittedStatements: Math.max(0, sources.length - MAX_REQUESTS),
    omittedReceipts: Math.max(0, observed.receipts.length - MAX_RECEIPTS), invalidReceiptEvents: observed.invalid,
    ungroundedRequestedObjective: !current && !!frame.requestedObjective.trim(),
    sourceChanges: { changed: Object.keys(sourceHashes).filter(id => sourceHashes[id] !== before[id]),
      removed: Object.keys(before).filter(id => !(id in sourceHashes)) }, semanticStatus: "literal_projection_only" };
  return { ...body, stateHash: hash(body) };
}

/** Compact current data. Real user/tool history remains in the actor compiler. */
export function obligationLedgerContext(ledger: ObligationLedger, options: ObligationContextOptions = {}): string {
  checkLedger(ledger);
  const maximum = options.maxCharacters ?? 5_120;
  if (!Number.isSafeInteger(maximum) || maximum < 768 || maximum > 32_768) fail("invalid context budget");
  let hypotheses: { interpretation: string; goals: GoalSet } | undefined;
  if (options.hypotheses) {
    const exposure = options.hypotheses;
    if (exposure.mode !== "experimental" || exposure.requestRevisionHash !== ledger.requestRevisionHash) fail("stale or unapproved hypothesis exposure");
    validateContract("GoalSet", exposure.goals);
    for (const goal of exposure.goals.hypotheses) for (const ref of [...goal.sources, ...goal.constraints.flatMap(item => item.sources)]) {
      if (!(ref.sourceId in ledger.sourceHashes) || ref.path.length) fail("hypothesis cites missing or non-user source");
    }
    hypotheses = { interpretation: "Fallible interpretation; citations do not establish entailment or authority.", goals: copy(exposure.goals) };
  }
  const latest = ledger.statements.at(-1);
  const body = { version: ledger.version, revision: ledger.requestRevisionHash,
    latestUserStatement: latest ? { evidence: latest.evidence, truncated: latest.truncated,
      observedLanguage: latest.observedLanguage, containsNativeStop: latest.containsNativeStop } : null,
    earlierUserSources: ledger.statements.slice(0, -1).map(item => item.evidence.source.sourceId),
    literalQualifiers: ledger.qualifiers.map(item => ({ kind: item.kind, text: item.evidence.quote,
      source: item.evidence.source, start: item.evidence.start, end: item.evidence.end })),
    observedReceipts: ledger.receipts.slice(-6).map(item => ({ tool: item.tool, callId: item.callId,
      reportedStatus: item.toolReportedStatus, source: item.responseSource })),
    omitted: { earlierStatements: ledger.omittedStatements, receipts: ledger.omittedReceipts + Math.max(0, ledger.receipts.length - 6),
      invalidReceiptEvents: ledger.invalidReceiptEvents },
    semanticCompleteness: "unassessed", confirmationAuthority: "server_owned_not_inferred",
    completion: "not_inferred_from_response_status", ...(hypotheses ? { experimentalHypotheses: hypotheses } : {}) };
  const serialized = canonical(body);
  if (serialized.length <= maximum) return serialized;
  // Never truncate a qualifier into the opposite meaning. Fall back to pointers
  // rather than presenting partial text as a complete requested obligation.
  const fallback = canonical({ version: ledger.version, revision: ledger.requestRevisionHash,
    latestUserSource: latest?.evidence.source ?? null, latestUserSourceHash: latest?.evidence.sourceHash ?? null,
    derivedTextOmitted: true, hypothesisExposureOmitted: !!hypotheses,
    instruction: "Consult the preserved real user messages and tool responses; this bounded projection does not assess completeness, confirmation or completion." });
  if (fallback.length > maximum) fail("context identity exceeds budget");
  return fallback;
}
