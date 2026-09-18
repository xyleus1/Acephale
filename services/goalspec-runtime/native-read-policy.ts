import { copy, hash } from "../../src/lib/goalspec/canonical";
import type { ExecutionFrame, Invocation, Scope, SourceRef } from "../../src/lib/goalspec/contracts/generated";
import type { Observation } from "../../src/lib/goalspec/scheduler";

const PINNED_ENVIRONMENT = "2174a603f6d014ef94473ffa95957f6ce27100db";
const IDENTITY = new Set(["find_user_id_by_email", "find_user_id_by_name_zip"]);
const RETAIL_READS = new Set([...IDENTITY, "get_user_details", "get_order_details", "get_product_details", "get_item_details", "list_all_product_types"]);
const AIRLINE_PUBLIC = new Set(["list_all_airports", "search_direct_flight", "search_onestop_flight", "get_flight_status"]);
type ObjectValue = Record<string, unknown>;
type Event = { kind?: string; seq?: number; call_id?: string; tool?: string; arguments?: ObjectValue; status?: string; result?: unknown; speculative?: boolean };
type VerifiedReceipt = { invocation: Invocation; observation: Observation; runId: string; scopeHash: string; policyHash: string;
  prefixLength: number; prefixHash: string; requirements: Record<string, string> };
const object = (value: unknown): value is ObjectValue => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(text);
const token = (value: unknown): value is string => text(value) && value.length <= 256 && !/\s/.test(value);

/** Audited effects only. This grants no read authorization or speculation.
 * Both pinned calculate implementations access expression text only, not DB.
 */
export function isNativeNonMutatingTool(domain: "retail" | "airline", tool: unknown): boolean {
  return typeof tool === "string" && (tool === "calculate" || (domain === "retail" ? RETAIL_READS.has(tool)
    : AIRLINE_PUBLIC.has(tool) || ["get_user_details", "get_reservation_details"].includes(tool)));
}

function supplied(value: unknown, requirements: string[], insensitive = false) {
  if (!text(value)) return false;
  const needle = insensitive ? value.toLowerCase() : value;
  return requirements.some(source => {
    const haystack = insensitive ? source.toLowerCase() : source;
    for (let offset = haystack.indexOf(needle); offset !== -1; offset = haystack.indexOf(needle, offset + 1)) {
      const before = haystack[offset - 1] ?? "", after = haystack[offset + needle.length] ?? "";
      if ((!before || !/[\p{L}\p{N}_@+-]/u.test(before)) && (!after || !/[\p{L}\p{N}_@+-]/u.test(after))) return true;
    }
    return false;
  });
}
function suppliedUserId(value: unknown, requirements: string[]) {
  if (!token(value) || !supplied(value, requirements)) return false;
  if (/[_\d]/.test(value)) return true;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Word-shaped IDs require an explicit typed assignment. The prose connective
  // in "my user ID and ..." has no assignment, while user_id='and' is valid.
  return requirements.some(requirement => new RegExp(`\\buser[ _-]*id\\b\\s*(?:is\\s+|[:=]\\s*)["']?${escaped}(?![\\p{L}\\p{N}_@+-])`, "iu").test(requirement));
}

/** Evidence of the existing unavailable-email prerequisite, never identity by
 * itself. Return original source references; punctuation normalization is only
 * used to recognize ordinary apostrophes and does not alter visible evidence.
 */
export function nativeEmailFallbackSources(frame: Pick<ExecutionFrame, "sources">): SourceRef[] {
  return Object.entries(frame.sources).flatMap(([sourceId, value]) => {
    if (!sourceId.startsWith("requirement:") || typeof value !== "string") return [];
    const normalized = value.replace(/[\u2018\u2019]/g, "'");
    const clauses = normalized.split(/[.!?;](?:\s|$)/);
    const unavailable = clauses.some(clause => {
      // Contradictions need clarification; do not let a negated inability or an
      // explicitly available email accidentally activate fallback.
      if (/\b(?:not|never)\s+(?:unable|unsure|unknown|unavailable)|\b(?:do|can)\s+(?:remember|recall|know|access|provide)\b.{0,25}\be-?mail\b/i.test(clause)) return false;
      return /\b(?:cannot|can't|can not|do not|don't|unable to)\s+(?:remember|recall|know|access|provide)\s+(?:(?:what|which|my|the|account|registered|current|old|correct|associated)\s+){0,4}e-?mail\b|\b(?:forgot|forgotten)\s+(?:(?:my|the|account|registered|current|old|correct)\s+){0,3}e-?mail\b|\b(?:not sure|unsure)\s+(?:(?:what|which|about|of)\s+)?(?:(?:my|the|account)\s+){0,2}e-?mail\b|\be-?mail\s+(?:address\s+)?(?:(?:is|was)\s+)?(?:unknown|unavailable)\b/i.test(clause);
    });
    return unavailable ? [{ sourceId, path: [] }] : [];
  });
}

/** Additional policy checks for the pinned native research tools only.
 * It grants no authoritative permission and learns only from real public calls.
 * Only observeVerified, called after successful server-side lease validation,
 * may add speculative observations to this policy state.
 */
export class NativeReadPolicy {
  private frame?: ExecutionFrame;
  private requirements: string[] = [];
  private userId?: string;
  private conflictingIdentity = false;
  private emailFailed = false;
  private profileUser?: string;
  private ownedRecords = new Set<string>();
  private relatedProducts = new Set<string>();
  private relatedItems = new Set<string>();
  private receipts: VerifiedReceipt[] = [];
  private validated = new Map<string, string>();
  constructor(private domain: "retail" | "airline", private scope: Scope) {
    this.scope = copy(scope);
  }
  nonMutating(invocation: Invocation): boolean {
    return !!this.frame && hash(invocation.scope) === hash(this.scope) && object(invocation.arguments)
      && isNativeNonMutatingTool(this.domain, invocation.tool);
  }
  private clearProfile() {
    this.profileUser = undefined; this.ownedRecords.clear(); this.relatedProducts.clear(); this.relatedItems.clear();
  }
  updateFrame(frame: ExecutionFrame): void {
    this.frame = undefined; this.requirements = []; this.userId = undefined;
    this.conflictingIdentity = false; this.emailFailed = false; this.clearProfile();
    this.validated.clear();
    if (hash(frame.scope) !== hash(this.scope) || frame.scope.environmentVersion !== PINNED_ENVIRONMENT
      || !frame.policy.trim() || !Array.isArray(frame.sources._binding_events)) { this.receipts = []; return; }
    this.frame = copy(frame);
    this.requirements = Object.entries(frame.sources).filter(([key]) => key.startsWith("requirement:"))
      .map(([, value]) => value).filter((value): value is string => typeof value === "string");
    // Reconstructed model-facing prefetch metadata is never an authoritative
    // authentication event. Only this guard's own retained receipts are trusted.
    const events = frame.sources._binding_events.filter(raw => !object(raw) || raw.speculative !== true);
    this.receipts = this.receipts.filter(receipt => receipt.runId === frame.runId && receipt.scopeHash === hash(frame.scope)
      && receipt.policyHash === hash(frame.policy) && receipt.prefixLength <= events.length
      && receipt.prefixHash === hash(events.slice(0, receipt.prefixLength))
      && Object.entries(receipt.requirements).every(([key, value]) => Object.hasOwn(frame.sources, key) && hash(frame.sources[key]) === value)
      && !events.slice(receipt.prefixLength).some(raw => object(raw) && raw.kind === "tool_request" && !isNativeNonMutatingTool(this.domain, raw.tool)));
    const requests = new Map<string, Event>(), completed = new Set<string>();
    for (let index = 0; index <= events.length; index++) {
      for (const receipt of this.receipts.filter(value => value.prefixLength === index)) {
        if (this.checkObservation(receipt.invocation, receipt.observation)) this.applySuccessful(receipt.invocation.tool, receipt.invocation.arguments, receipt.observation);
      }
      if (index === events.length) break;
      const raw = events[index];
      if (!object(raw)) { this.frame = undefined; return; }
      const event = raw as Event;
      if (event.kind === "tool_request") {
        if (!event.call_id || requests.has(event.call_id) || !event.tool || !object(event.arguments)) { this.frame = undefined; return; }
        requests.set(event.call_id, event); continue;
      }
      if (event.kind !== "tool_result") continue;
      const request = event.call_id ? requests.get(event.call_id) : undefined;
      if (!request || completed.has(event.call_id!) || event.tool !== request.tool) { this.frame = undefined; return; }
      completed.add(event.call_id!);
      const args = request.arguments!;
      if (this.domain === "retail" && request.tool === "find_user_id_by_email" && event.status !== "success") this.emailFailed = true;
      if (event.status !== "success") continue;
      this.applySuccessful(request.tool!, args, event.result);
    }
  }
  private applySuccessful(tool: string, args: ObjectValue, result: unknown) {
      if (this.domain === "retail" && IDENTITY.has(tool)) {
        if (!this.identityArguments(tool, args) || !token(result)) return;
        if (this.userId && this.userId !== result) { this.conflictingIdentity = true; this.clearProfile(); return; }
        this.userId = result;
      } else if (tool === "get_user_details") {
        this.clearProfile();
        if (!object(result) || !text(args.user_id) || result.user_id !== args.user_id) return;
        if (this.domain === "retail" ? args.user_id !== this.userId || this.conflictingIdentity : !suppliedUserId(args.user_id, this.requirements)) return;
        const owned = this.domain === "retail" ? result.orders : result.reservations;
        if (!strings(owned)) return;
        if (this.domain === "airline" && this.userId && this.userId !== args.user_id) { this.conflictingIdentity = true; return; }
        this.userId = args.user_id; this.profileUser = args.user_id; this.ownedRecords = new Set(owned);
      } else if (this.domain === "retail" && tool === "get_order_details"
        && this.orderObservation(args.order_id, result)) {
        const items = (result as ObjectValue).items as ObjectValue[];
        for (const item of items) { this.relatedProducts.add(item.product_id as string); this.relatedItems.add(item.item_id as string); }
      } else if (this.domain === "retail" && tool === "get_product_details" && text(args.product_id)
        && this.relatedProducts.has(args.product_id) && object(result) && result.product_id === args.product_id && object(result.variants)) {
        for (const [id, item] of Object.entries(result.variants)) if (object(item) && item.item_id === id) this.relatedItems.add(id);
      }
  }
  private identityArguments(tool: string, args: ObjectValue) {
    if (tool === "find_user_id_by_email") return Object.keys(args).length === 1 && text(args.email)
      && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.email) && supplied(args.email, this.requirements, true);
    return Object.keys(args).length === 3 && supplied(args.first_name, this.requirements, true)
      && supplied(args.last_name, this.requirements, true) && supplied(args.zip, this.requirements);
  }
  private identityFallbackAvailable() {
    return this.emailFailed || !!this.frame && nativeEmailFallbackSources(this.frame).length > 0;
  }
  eligible(invocation: Invocation): boolean {
    if (!this.frame || hash(invocation.scope) !== hash(this.scope) || !object(invocation.arguments)) return false;
    const args = invocation.arguments;
    if (this.domain === "airline") {
      if (AIRLINE_PUBLIC.has(invocation.tool)) return true;
      if (this.conflictingIdentity) return false;
      if (invocation.tool === "get_user_details") return text(args.user_id) && suppliedUserId(args.user_id, this.requirements)
        && (!this.userId || args.user_id === this.userId);
      return invocation.tool === "get_reservation_details" && this.profileUser === this.userId
        && text(args.reservation_id) && this.ownedRecords.has(args.reservation_id);
    }
    if (!RETAIL_READS.has(invocation.tool) || this.conflictingIdentity) return false;
    if (IDENTITY.has(invocation.tool)) {
      const acceptedSameIdentity = !!this.userId && this.receipts.some(receipt => hash(receipt.invocation) === hash(invocation)
        && receipt.observation === this.userId);
      return (!this.userId || acceptedSameIdentity) && this.identityArguments(invocation.tool, args)
        && (invocation.tool !== "find_user_id_by_name_zip" || this.identityFallbackAvailable());
    }
    if (!this.userId) return false;
    if (invocation.tool === "get_user_details") return args.user_id === this.userId;
    if (this.profileUser !== this.userId) return false;
    if (invocation.tool === "get_order_details") return text(args.order_id) && this.ownedRecords.has(args.order_id);
    if (invocation.tool === "get_product_details") return text(args.product_id) && this.relatedProducts.has(args.product_id);
    if (invocation.tool === "get_item_details") return text(args.item_id) && this.relatedItems.has(args.item_id);
    // Native policy restricts product information to related products. A complete
    // catalog cannot establish that relation and remains ineligible here.
    return false;
  }
  private orderObservation(id: unknown, value: unknown): boolean {
    return !this.conflictingIdentity && !!this.profileUser && this.profileUser === this.userId
      && text(id) && this.ownedRecords.has(id) && object(value) && value.order_id === id && value.user_id === this.userId
      && Array.isArray(value.items) && value.items.every(item => object(item) && text(item.product_id) && text(item.item_id));
  }
  private checkObservation(invocation: Invocation, observation: Observation): boolean {
    if (!this.eligible(invocation)) return false;
    const args = invocation.arguments;
    if (this.domain === "airline" && AIRLINE_PUBLIC.has(invocation.tool)) return observation !== null;
    if (IDENTITY.has(invocation.tool)) return token(observation) && (!this.userId || observation === this.userId);
    if (!object(observation)) return false;
    if (invocation.tool === "get_user_details") return observation.user_id === args.user_id
      && strings(this.domain === "retail" ? observation.orders : observation.reservations);
    if (invocation.tool === "get_order_details") return this.orderObservation(args.order_id, observation);
    if (invocation.tool === "get_reservation_details") return observation.reservation_id === args.reservation_id
      && observation.user_id === this.userId;
    if (invocation.tool === "get_product_details") return observation.product_id === args.product_id && object(observation.variants)
      && Object.entries(observation.variants).every(([id, item]) => object(item) && item.item_id === id);
    if (invocation.tool === "get_item_details") return observation.item_id === args.item_id;
    return false;
  }
  validateObservation(invocation: Invocation, observation: Observation): boolean {
    const valid = this.checkObservation(invocation, observation), key = hash(invocation);
    if (valid) this.validated.set(key, hash(observation)); else this.validated.delete(key);
    return valid;
  }
  /** Call only after Python confirms freshness, never after read execution alone.
   * A prior local validation and current eligibility are both required. Receipts
   * stay outside model input and are fenced when public state no longer extends
   * their source checkpoint. The scheduler must also fence mutation generations.
   */
  observeVerified(invocation: Invocation, observation: Observation): boolean {
    const key = hash(invocation);
    if (!this.frame || this.validated.get(key) !== hash(observation) || !this.checkObservation(invocation, observation)) return false;
    this.validated.delete(key);
    const events = (this.frame.sources._binding_events as unknown[]).filter(raw => !object(raw) || raw.speculative !== true);
    const receipt: VerifiedReceipt = { invocation: copy(invocation), observation: copy(observation), runId: this.frame.runId,
      scopeHash: hash(this.frame.scope), policyHash: hash(this.frame.policy), prefixLength: events.length, prefixHash: hash(events),
      requirements: Object.fromEntries(Object.entries(this.frame.sources).filter(([id]) => id.startsWith("requirement:")).map(([id, value]) => [id, hash(value)])) };
    const existing = this.receipts.findIndex(value => hash(value.invocation) === key
      && value.prefixLength === receipt.prefixLength && value.prefixHash === receipt.prefixHash);
    // Keep causal ordering among identity, profile and owned-record receipts.
    // A later refresh must not move identity behind a profile that depends on it.
    if (existing >= 0) this.receipts[existing] = receipt;
    else this.receipts = [...this.receipts, receipt].slice(-32);
    this.applySuccessful(invocation.tool, invocation.arguments, observation);
    return true;
  }
}
