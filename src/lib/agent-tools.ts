// Server-only module (NOT a "use server" file - that directive only allows
// async-function exports, but we also export the TOOLS array constant).
// The functions here are called from within other server actions, so they
// run server-side regardless.
import "server-only";
import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { draftReplyToMessage, draftCounterOffer } from "./sourcing-award";
import { extractSourcingOffersForInquiry } from "./sourcing-offers";
import { findStuckJobs } from "./stuck-jobs";
import { analyzeJobDocument, askAboutDocument } from "./doc-analyze";
import { createPendingBulkHideThreadsProposal, createPendingJobActionProposal, createPendingJobUpdateProposal } from "./agent-proposals";
import { qualifyRfq } from "./rfq-qualification";
import { openInquiryStatusFilter } from "./inquiry-status";
import { loadLeadBoard } from "./lead-board-query";
import { leadBoardRowForAgent, LEAD_BOARD_STAGES, type LeadBoardStage } from "./lead-board";
import { buildMissingInfoDraft } from "./missing-info-draft";
import { displayParty } from "./whatsapp-display";
import { parsePipeLines } from "./quote-lines";
import { assessInquiryStrategy, assessJobStrategy, compactStrategyForAgent, loadInquiryStrategyInput, loadJobStrategyInput } from "./commercial-strategy-persistence";
import { listDecisionQueueItems, type DecisionQueueItem } from "./decision-queue";
import { buildDecisionQueueBrief } from "./decision-queue-brief";
import { REFERENCE_DEALS, buildReferenceDealOperatorPlaybook, getReferenceDealById, getReferenceDealDecisions, getReferenceDealSummary, referenceDealDecisionPlan, referenceDealToRfqDraft } from "./reference-deals";
import { proposeDuplicateInquiryConsolidation, proposeMergeAllOpenInquiriesIntoOne } from "./merge-actions";
import { createForwarderRequestDrafts } from "./forwarder-drafts";
import { buildCustomerQuoteDraft, type CustomerQuoteDraftContext } from "./customer-quote-draft";
import { simulatePricingScenario } from "./pricing-scenario";
import { buildPricingCommandFactors } from "./pricing-command-factors";
import { buildDocumentReadiness } from "./document-readiness";
import { createPortalToken } from "./portal-token";
import { getCustomerDossier } from "./memory/customer-dossier";
import { generateMorningBrief } from "./memory/morning-brief";
import { explainStrategyDecision, searchCustomerMemory, searchJobMemory } from "./memory/search-memory";
import {
  getCustomerMarketExposure,
  getLaneIntelligence,
  getMarketSourceQuality,
  ingestMarketSourcePreview,
  listMarketSources,
  listMarketResearchFeed,
  runMarketSourceIngestion,
  searchMarketIntelligence,
  searchMarketResearch,
} from "./market-intelligence/market-tools";
import {
  acknowledgeMarketImpactReview,
  dismissMarketImpactReview,
  listMarketImpactReviews,
  markMarketImpactActioned,
  recordMarketSignalFeedback,
} from "./market-intelligence/market-impact-review";
import {
  buildHardwareImportAgentBrief,
  getCensusPublicHardwareSnapshot,
} from "@/lib/intel/server";
import type { StrategyEvidenceCheck } from "./commercial-strategy";
import { operatorMetricLabel } from "./operator-action-labels";

// Tool schemas use the app's provider-neutral input_schema shape. The shared
// GPT-5.6 adapter converts these to Responses API function tools.
export const TOOLS = [
  // ── Lookups ────────────────────────────────────────────────────────────────
  {
    name: "search_jobs",
    description: "Search the user's jobs by free-text. Matches reference, origin, destination, commodity, customer name, or notes.",
    input_schema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Search query" },
        type: { type: "string", enum: ["SOURCING", "FORWARDING"], description: "Optional type filter" },
        status: { type: "string", description: "Optional status filter (PROPOSED/INQUIRY/QUOTED/BOOKED/IN_TRANSIT/CUSTOMS/DELIVERED)" },
        limit: { type: "number", description: "Max results, default 10" },
      },
      required: ["q"],
    },
  },
  {
    name: "search_inquiries",
    description: "Search RFQs/inquiries by subject, commodity, sender, or route.",
    input_schema: {
      type: "object",
      properties: {
        q: { type: "string" },
        type: { type: "string", enum: ["SOURCING", "FORWARDING"] },
        limit: { type: "number" },
      },
      required: ["q"],
    },
  },
  {
    name: "search_companies",
    description: "Search customer/company records by name.",
    input_schema: {
      type: "object",
      properties: {
        q: { type: "string" },
        limit: { type: "number" },
      },
      required: ["q"],
    },
  },
  {
    name: "search_email_threads",
    description: "Full-text search across email threads - subjects, bodies, sender names/emails.",
    input_schema: {
      type: "object",
      properties: {
        q: { type: "string" },
        only_unlinked: { type: "boolean", description: "Only threads not linked to a job/inquiry" },
        limit: { type: "number" },
      },
      required: ["q"],
    },
  },
  {
    name: "get_customer_dossier",
    description: "Return the canonical customer dossier from CRM records plus recent company memory events and knowledge objects. Use before answering customer history, risk, relationship, or account-memory questions.",
    input_schema: {
      type: "object",
      properties: {
        company_id: { type: "string", description: "Exact company id if known" },
        query: { type: "string", description: "Fallback company name search when company_id is unknown" },
        limit: { type: "number", description: "Max memory items. Default 20" },
      },
    },
  },
  {
    name: "search_customer_memory",
    description: "Hybrid deterministic search across source-linked customer memory: KnowledgeObjects, chunks, entity mentions, and MemoryEvents. No vector search yet. Returns evidence refs.",
    input_schema: {
      type: "object",
      properties: {
        company_id: { type: "string", description: "Exact company id" },
        query: { type: "string", description: "Keyword query" },
        limit: { type: "number", description: "Max results. Default 20" },
      },
      required: ["company_id", "query"],
    },
  },
  {
    name: "search_job_memory",
    description: "Hybrid deterministic search across source-linked job memory: RFQs, emails, documents, strategy assessments, events, chunks, and entity mentions. Returns evidence refs.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Exact job id or job reference. Defaults to focused job." },
        query: { type: "string", description: "Keyword query" },
        limit: { type: "number", description: "Max results. Default 20" },
      },
      required: ["query"],
    },
  },
  {
    name: "explain_strategy_decision",
    description: "Explain the latest persisted commercial strategy decision from StrategyAssessment plus hybrid memory evidence. Use for why price/route/risk/quote decisions were made.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Exact job id or job reference. Defaults to focused job." },
        inquiry_id: { type: "string", description: "RFQ/inquiry id when no job exists yet." },
      },
    },
  },
  {
    name: "get_hardware_import_report",
    description: "Return the official, read-only China to U.S. West Coast hardware import report brief. Use first for hardware import volume, historical China customs data, California destination demand, West Coast gateway districts, startup production hardware, ImportGenius, TradeAtlas, Trademo, or hardware-import lead research. The full cited report is attached by the Intel chat UI when this tool succeeds.",
    input_schema: {
      type: "object",
      properties: {
        focus: {
          type: "string",
          description: "Optional focus such as history, gateway, category, provider, customs, or leads",
        },
      },
    },
  },
  {
    name: "search_market_intelligence",
    description: "Search external freight/logistics intelligence ingested into company memory as market updates and operational MarketSignals. Use for market events, freight news impact, rate pressure, disruption, customs, capacity, labor, carrier advisory, or compliance context. Returns evidence refs.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keyword query such as Asia-Europe rates, Hamburg congestion, customs, Red Sea, Maersk" },
        category: { type: "string", enum: ["rate", "port_disruption", "customs", "carrier_advisory", "weather", "labor", "geopolitical", "capacity", "compliance"] },
        severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
        limit: { type: "number", description: "Max results. Default 12" },
      },
    },
  },
  {
    name: "get_lane_intelligence",
    description: "Return recent MarketSignals that overlap a lane/mode. Use before answering whether an RFQ/job lane is affected by rate pressure, disruption, customs, carrier, or capacity signals.",
    input_schema: {
      type: "object",
      properties: {
        origin: { type: "string", description: "Lane origin, country, region, or port" },
        destination: { type: "string", description: "Lane destination, country, region, or port" },
        mode: { type: "string", description: "Optional mode such as ocean, SEA-FCL, AIR, ROAD" },
        limit: { type: "number", description: "Max signals. Default 12" },
      },
      required: ["origin", "destination"],
    },
  },
  {
    name: "get_customer_market_exposure",
    description: "Return MarketSignals linked to a customer through affected active RFQs/jobs/lanes. Use for customer risk, market exposure, affected quotes, and proactive account follow-up.",
    input_schema: {
      type: "object",
      properties: {
        company_id: { type: "string", description: "Exact company id. Defaults to scoped customer when available." },
        query: { type: "string", description: "Fallback customer name search" },
        limit: { type: "number", description: "Max signals. Default 12" },
      },
    },
  },
  {
    name: "search_market_research",
    description: "Search raw external market research KnowledgeObjects ingested from approved sources. Use when the user asks what source article/update/research said before interpreting it as operational impact. Returns evidence refs.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keyword query such as Asia-Europe rate update, port advisory, customs rule, carrier notice" },
        limit: { type: "number", description: "Max research objects. Default 12" },
      },
      required: ["query"],
    },
  },
  {
    name: "list_market_research_feed",
    description: "List the latest approved-source market research feed items, their source quality, extracted MarketSignals, and review counts. Read-only.",
    input_schema: {
      type: "object",
      properties: {
        source_id: { type: "string", description: "Optional KnowledgeSource/source registry id filter" },
        query: { type: "string", description: "Optional keyword filter" },
        limit: { type: "number", description: "Max feed items. Default 20" },
      },
    },
  },
  {
    name: "ingest_market_source_preview",
    description: "Preview a Firecrawl-backed market source fetch without persisting objects, signals, reviews, or operational changes. Use only when the user explicitly asks to preview live market source ingestion.",
    input_schema: {
      type: "object",
      properties: {
        source_id: { type: "string", description: "Source registry id for a Firecrawl source" },
        query: { type: "string", description: "Search query for firecrawl_search sources" },
        url: { type: "string", description: "URL for firecrawl_scrape sources; must match source policy" },
        limit: { type: "number", description: "Max preview results. Default from source policy" },
      },
      required: ["source_id"],
    },
  },
  {
    name: "list_market_sources",
    description: "List curated market intelligence sources, trust levels, source policy checks, and quality summaries. Read-only.",
    input_schema: {
      type: "object",
      properties: {
        include_disabled: { type: "boolean", description: "Include disabled sources. Default true." },
      },
    },
  },
  {
    name: "get_market_source_quality",
    description: "Return deterministic source quality scores from trust level plus feedback/review outcomes. Read-only.",
    input_schema: {
      type: "object",
      properties: {
        source_id: { type: "string", description: "Optional source registry id." },
      },
    },
  },
  {
    name: "preview_market_source",
    description: "Preview a single Firecrawl-backed market source without persisting memory or operational records. Requires an explicit source id.",
    input_schema: {
      type: "object",
      properties: {
        source_id: { type: "string", description: "Source registry id" },
        query: { type: "string", description: "Optional search query for firecrawl_search sources" },
        url: { type: "string", description: "Optional URL for firecrawl_scrape sources; must match source policy" },
        limit: { type: "number", description: "Max preview results" },
      },
      required: ["source_id"],
    },
  },
  {
    name: "run_market_source_ingestion",
    description: "Run or dry-run ingestion for one explicit curated market source. This can create market memory but cannot mutate jobs, RFQs, quotes, prices, milestones, customers, or messages.",
    input_schema: {
      type: "object",
      properties: {
        source_id: { type: "string", description: "Exact source registry id. Required to avoid broad crawls." },
        dry_run: { type: "boolean", description: "When true, return the scheduled ingestion plan without calling Firecrawl or writing memory." },
        limit: { type: "number", description: "Max pages/results for this single-source run." },
      },
      required: ["source_id"],
    },
  },
  {
    name: "list_market_impacts",
    description: "List reviewable market impact action items created from MarketSignal links. Use for pending market impact review, affected RFQs/jobs/customers, and what operators should review next. Read-only.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pending", "acknowledged", "dismissed", "actioned", "expired"], description: "Review status. Defaults to pending if omitted by the user intent." },
        linked_entity_type: { type: "string", enum: ["company", "job", "inquiry", "lane", "quote", "strategy"] },
        linked_entity_id: { type: "string", description: "Exact linked entity id." },
        market_signal_id: { type: "string", description: "Exact MarketSignal id." },
        min_impact_level: { type: "string", enum: ["low", "medium", "high", "critical"] },
        limit: { type: "number", description: "Max review items. Default 20" },
      },
    },
  },
  {
    name: "acknowledge_market_impact",
    description: "Mark a market impact review as acknowledged. This changes only review status; it does not mutate jobs, quotes, customers, or messages.",
    input_schema: {
      type: "object",
      properties: {
        review_id: { type: "string", description: "MarketImpactReview id" },
      },
      required: ["review_id"],
    },
  },
  {
    name: "dismiss_market_impact",
    description: "Dismiss a market impact review with optional feedback. This changes only review status; it does not mutate jobs, quotes, customers, or messages.",
    input_schema: {
      type: "object",
      properties: {
        review_id: { type: "string", description: "MarketImpactReview id" },
        feedback_kind: { type: "string", enum: ["irrelevant", "wrong_link", "duplicate", "already_known", "severity_wrong", "source_low_quality"] },
        feedback_note: { type: "string" },
      },
      required: ["review_id"],
    },
  },
  {
    name: "mark_market_impact_actioned",
    description: "Mark a market impact review as actioned after a human/operator handled it. This records review state only; it does not perform the operational action.",
    input_schema: {
      type: "object",
      properties: {
        review_id: { type: "string", description: "MarketImpactReview id" },
        feedback_note: { type: "string", description: "Optional note describing the action taken outside this tool." },
      },
      required: ["review_id"],
    },
  },
  {
    name: "record_market_signal_feedback",
    description: "Record feedback about a MarketSignal or specific market impact review. This is training/evaluation data and does not change operational records.",
    input_schema: {
      type: "object",
      properties: {
        market_signal_id: { type: "string", description: "MarketSignal id" },
        review_id: { type: "string", description: "Optional MarketImpactReview id" },
        feedback_kind: { type: "string", enum: ["useful", "irrelevant", "wrong_link", "duplicate", "already_known", "severity_wrong", "source_low_quality"] },
        note: { type: "string" },
      },
      required: ["market_signal_id", "feedback_kind"],
    },
  },
  {
    name: "get_job",
    description: "Fetch full details of one job: status, customer, route, milestones, supplier offers (if SOURCING) or carrier quotes (if FORWARDING), linked inquiry, documents.",
    input_schema: {
      type: "object",
      properties: { job_id: { type: "string" } },
      required: ["job_id"],
    },
  },
  {
    name: "list_open_inquiries",
    description: "List inquiries currently in active statuses (INGESTED/PARSED/PRICED/QUOTED).",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["SOURCING", "FORWARDING"] },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "list_lead_board",
    description: "List Meta ad lead cards from the Incoming RFQs lead board (Facebook/Instagram lead-form RFQs, US and TR markets) with lead quality tier and the automated outreach sequence state: emails sent (max 4), waiting, replied (with reply time and excerpt), dropped, or taken over by the desk. Use for any lead-board question: which leads replied to our emails, new leads that arrived recently, leads awaiting follow-up, dropped leads, or 'the leads/loads on the Incoming RFQs page'. These lead cards are inquiries worked by an email sequence, NOT jobs - never answer lead questions from job tools.",
    input_schema: {
      type: "object",
      properties: {
        market: { type: "string", enum: ["US", "TR"], description: "US = California lead sheet (the US cards view), TR = Türkiye sheet. Omit for both markets." },
        stage: { type: "string", enum: ["replied", "waiting", "new", "dropped", "desk"], description: "replied = the lead answered our outreach and needs desk action; waiting = emailed, no reply yet; new = not emailed yet; dropped = sequence exhausted or lead closed; desk = an operator took it over." },
        quality: { type: "string", enum: ["GOOD", "REVIEW", "WEAK"], description: "Lead quality tier. The board shows GOOD ('Good') by default; REVIEW displays as 'Maybe'." },
        arrived_within_days: { type: "number", description: "Only leads received in the last N days." },
        replied_within_days: { type: "number", description: "Only leads whose reply landed in the last N days." },
        status_scope: { type: "string", enum: ["open", "all"], description: "open = only open RFQ statuses (the board's default Open tab). Default all: dropped/booked leads are only visible under all." },
        q: { type: "string", description: "Free-text match on reference (DRY...), route, commodity, contact, or company." },
        limit: { type: "number", description: "Max leads returned. Default 20, max 60." },
      },
    },
  },
  {
    name: "list_threads_awaiting_reply",
    description: "List email threads where the latest message is INBOUND (no outbound reply yet) - i.e. waiting on the operator.",
    input_schema: { type: "object", properties: { limit: { type: "number" } } },
  },
  {
    name: "list_stuck_jobs",
    description: "Active jobs that haven't moved in N+ days. Returns each with an AI-suggested next action.",
    input_schema: {
      type: "object",
      properties: {
        days_threshold: { type: "number", description: "How many days idle counts as stuck. Default 5." },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "morning_briefing",
    description: "Aggregate snapshot plus the ranked commercial decision queue for the office.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_decision_queue",
    description: "Return the ranked Desk decision queue with operator_summary, execution_brief, safe_action_label, priority_label, decision_contract, decision_move owner/command, command_ledger stop rules, gate_checks, rank_reasons, exact blockers/asks, and priority_factors explaining value, profit, maturity, target, document proof, coverage, and age. Use for 'what should I work on', 'what is most urgent', 'what is on my plate', or 'run the desk'.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max decision items. Default 8, max 15." },
      },
    },
  },
  {
    name: "list_pricing_commands",
    description: "Return the ranked commercial pricing brain queue from persisted StrategyAssessment decision briefs: RFQs/jobs to mature, rate, review, quote, or park. Includes decision_quality, operator_playbook, and cached route_decision with selected route, alternatives, freshness, risk, and quote-gate safety so the agent can act without guessing. Use for pricing desk, commercial brain queue, RFQs to price, quote gate, or 'what should pricing do next'. Does not recompute strategy.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max pricing commands. Default 8, max 15." },
        include_stale: { type: "boolean", description: "Include stale cached assessments whose RFQ/job changed after the snapshot. Default true." },
      },
    },
  },
  {
    name: "inspect_control_sheet",
    description: "Inspect the pasted control-sheet snapshot: ranked lead/deal rows, known contract/profit, missing data, hygiene problems, and next actions. Use for control sheet, lead board, pasted sheet data, 'what from the sheet matters', or 'where is the money'.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max ranked rows/actions. Default 6, max 12." },
      },
    },
  },
  {
    name: "prepare_control_sheet_rfq",
    description: "Prepare, but do not create, an RFQ draft from one pasted control-sheet lead. Returns explicit mapped fields, missing RFQ maturity blockers, and source economics. Use when the user asks whether a sheet row can become an RFQ.",
    input_schema: {
      type: "object",
      properties: {
        deal_id: { type: "string", description: "Exact reference deal id if known." },
        query: { type: "string", description: "Fallback search text such as contract, contact, or product." },
      },
    },
  },
  {
    name: "inspect_job_readiness",
    description: "Audit the focused job for missing fields, quote readiness, booking/shipping blockers, document issues, stale email replies, and the next concrete fixes. Use this for 'what is missing', 'is this ready', 'what is blocking this job', or quality-control questions.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Defaults to focused job" },
        goal: { type: "string", enum: ["QUOTE", "BOOK", "SHIP", "DELIVER", "GENERAL"], description: "Optional readiness target. Defaults from current job stage." },
      },
    },
  },
  {
    name: "plan_next_actions",
    description: "Produce a prioritized operating plan for the focused job using current freight fields, rates/offers, documents, milestones, and email state. Use this for 'what should I do next', 'build me a plan', 'triage this load', or 'run the desk'.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Defaults to focused job" },
        limit: { type: "number", description: "Max actions to return. Default 6." },
      },
    },
  },
  {
    name: "inspect_brain",
    description: "Read the canonical commercial brain packet for the focused job/RFQ before answering strategy, next-action, quote, risk, price, route, blocker, or 'why' questions. Returns the decision contract, proof gaps, command ledger, safe agent moves, forbidden moves, and visible page targets. This is the source of truth for what the agent should say and what it must not do.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Defaults to focused job" },
        inquiry_id: { type: "string", description: "Optional RFQ/inquiry id when no job exists yet" },
      },
    },
  },
  {
    name: "assess_strategy",
    description: "Run the commercial decision brain for a job/RFQ: decision quality, price, route, risk, margin guardrails, win probability, and recommended next actions. Use for strategy, price, route, risk, margin, quote/no-quote, or negotiation questions.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Defaults to focused job" },
        inquiry_id: { type: "string", description: "Optional RFQ/inquiry id when no job exists yet" },
      },
    },
  },
  {
    name: "compare_routes",
    description: "Compare route/service options from live quotes, lane rates, and history. Returns a validity-aware route decision table with cost, risk, confidence, rate freshness, quote-gate status, and tradeoff.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Defaults to focused job" },
        inquiry_id: { type: "string" },
      },
    },
  },
  {
    name: "recommend_price",
    description: "Return decision quality, floor, recommended, stretch, walk-away, expected margin/profit, win probability, and guardrail status for a job/RFQ.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Defaults to focused job" },
        inquiry_id: { type: "string" },
      },
    },
  },
  {
    name: "simulate_pricing_scenario",
    description: "Run a non-persistent what-if scenario for a job/RFQ by temporarily changing customer target, buy cost, and margin policy. Use for questions like 'can we take USD 2300?', 'what buy cost do we need?', 'what if DSV gives 1900?', or 'does this target clear floor?'. Does not edit the job, RFQ, target history, carrier quotes, or strategy snapshots.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Defaults to focused job" },
        inquiry_id: { type: "string", description: "Optional RFQ/inquiry id when no job exists yet" },
        target_price: { type: "number", description: "Customer target price to test. Omit when only testing buy cost." },
        target_currency: { type: "string", enum: ["USD", "EUR", "GBP", "TRY"], description: "Currency for target/buy assumptions. Defaults from job/RFQ." },
        no_target: { type: "boolean", description: "Test explicit no-target confirmation." },
        buy_cost: { type: "number", description: "Forwarder/vendor buy cost to test." },
        assume_live_buy_cost: { type: "boolean", description: "When buy_cost is supplied, treat it as a received live quote. Default true." },
        replace_existing_quotes: { type: "boolean", description: "If true, ignore existing carrier quotes and use only the scenario buy cost." },
        transit_days: { type: "number", description: "Optional scenario transit days for route risk." },
        target_margin_pct: { type: "number", description: "Optional target margin policy override." },
        min_margin_pct: { type: "number", description: "Optional minimum margin/floor policy override." },
        stretch_margin_pct: { type: "number", description: "Optional stretch margin policy override." },
      },
    },
  },
  {
    name: "draft_customer_quote",
    description: "Draft a reviewed customer quote from the commercial strategy when the quote gate is ready. Does not send email, create a Quote row, or add Job.quoteLines.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Defaults to focused job" },
        inquiry_id: { type: "string", description: "Optional RFQ/inquiry id; overrides focused job when supplied." },
      },
    },
  },
  {
    name: "explain_risk",
    description: "Explain the commercial, cargo, route, customer, timing, and confidence risks behind the current strategy recommendation.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Defaults to focused job" },
        inquiry_id: { type: "string" },
      },
    },
  },
  {
    name: "draft_negotiation_plan",
    description: "Draft a tactical negotiation plan from the persisted strategy: customer posture, forwarder counter target, margin guardrail, and exact next move. Does not send anything.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Defaults to focused job" },
        inquiry_id: { type: "string" },
      },
    },
  },
  {
    name: "create_forwarder_drafts",
    description: "Create reviewed outbound forwarder RFQ email drafts for a mature RFQ only. Does not send email. Use when the strategy/operator decision says to create forwarder drafts or get live rates.",
    input_schema: {
      type: "object",
      properties: {
        inquiry_id: { type: "string", description: "RFQ/inquiry id. If omitted, uses the focused job's linked inquiry." },
        job_id: { type: "string", description: "Focused job id or reference; used only to resolve its linked inquiry." },
        forwarder_ids: {
          type: "array",
          items: { type: "string" },
          description: "Optional exact forwarder ids. Omit to create drafts for every active forwarder matching the RFQ mode.",
        },
      },
    },
  },
  {
    name: "draft_missing_info_request",
    description: "Draft a customer email asking only for missing RFQ maturity fields, using known sheet/source context when available. Does not send anything.",
    input_schema: {
      type: "object",
      properties: {
        inquiry_id: { type: "string", description: "RFQ/inquiry id. If omitted, uses focused job's inquiry or newest open RFQ." },
        job_id: { type: "string", description: "Optional job id/reference when drafting from a converted/focused job." },
      },
    },
  },
  {
    name: "find_follow_up_targets",
    description: "Find stale email threads that need a nudge. Can scope to the focused job or scan the office. Returns thread ids, age, last speaker, linked job/RFQ, and suggested follow-up intent.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Defaults to focused job if present. Omit with scope='office' to scan all threads." },
        scope: { type: "string", enum: ["focused_job", "office"], description: "Default focused_job when a job is in scope, otherwise office." },
        hours_threshold: { type: "number", description: "Minimum age since last email. Default 24." },
        limit: { type: "number", description: "Max results. Default 10." },
      },
    },
  },
  {
    name: "draft_customer_update",
    description: "Draft a concise customer-facing status update for the focused job from live job state. Does not send email. Optionally creates/includes the customer portal link.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Defaults to focused job" },
        intent: { type: "string", description: "Optional angle, e.g. 'delay explanation', 'booking confirmed', 'documents pending'." },
        include_portal: { type: "boolean", description: "If true, creates a portal token if missing and includes the portal URL. Default true." },
      },
    },
  },
  {
    name: "summarize_supplier_offers",
    description: "For a SOURCING job, list every linked thread's supplier offer, ranked by price (cheapest first). Auto-extracts offers from emails if they haven't been parsed. Use this when the operator asks about prices, rates, or supplier comparison on a procurement job.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Job to summarize. Defaults to the focused job if omitted." },
      },
    },
  },
  {
    name: "summarize_carrier_rates",
    description: "For a FORWARDING job, list received carrier rates ranked by total cost. Use when operator asks about rates on a shipping/forwarding job.",
    input_schema: {
      type: "object",
      properties: { job_id: { type: "string" } },
    },
  },

  // ── Mutations ──────────────────────────────────────────────────────────────
  {
    name: "merge_inquiries_into_one",
    description: "Create a human-review proposal to consolidate open RFQs/inquiries into one deal. Does not mutate immediately; the Inbox review panel must be applied.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["SOURCING", "FORWARDING"], description: "Filter to merge only this type" },
        subject: { type: "string", description: "Override the AI-generated subject for the keeper" },
        commodity: { type: "string" },
        origin: { type: "string" },
        destination: { type: "string" },
        weight_kg: { type: "number", description: "Total weight in kilograms" },
      },
    },
  },
  {
    name: "dedup_inquiries",
    description: "Run an AI duplicate scan and create a human-review proposal listing the clusters to merge. Does not mutate immediately.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "populate_job_from_emails",
    description: "Audit-blocked from chat. Do not fill job fields directly; use reviewed paste proposals or the job page Propose from emails control.",
    input_schema: { type: "object", properties: { job_id: { type: "string" } } },
  },
  {
    name: "award_supplier",
    description: "Mark a SOURCING supplier as the winner. Advances job to 'Awarded', sets cost from their offer, drafts a confirmation email, and auto-creates a child FORWARDING job for the actual shipment.",
    input_schema: {
      type: "object",
      properties: {
        thread_id: { type: "string", description: "EmailThread id of the winning supplier. If omitted, uses cheapest priced thread on the focused job." },
        supplier_hint: { type: "string", description: "Partial supplier name for fuzzy match (e.g. 'orlazul'). Used only if thread_id omitted." },
        job_id: { type: "string" },
      },
    },
  },
  {
    name: "draft_reply",
    description: "Draft an email reply to the latest inbound message on a thread. Operator can pass intent like 'ask for sample' or 'accept the offer'.",
    input_schema: {
      type: "object",
      properties: {
        thread_id: { type: "string", description: "Defaults to most recent thread on the focused job" },
        intent: { type: "string", description: "Stance/instruction for the AI drafter" },
      },
    },
  },
  {
    name: "draft_counter_offer",
    description: "Draft a polite counter-offer email to a SOURCING supplier. Uses market context from sibling supplier offers but never names competitors.",
    input_schema: {
      type: "object",
      properties: {
        thread_id: { type: "string" },
        target: { type: "string", description: "Target price or instruction (e.g. '$480/MT', '5% under best', 'match cheapest')" },
      },
      required: ["target"],
    },
  },
  {
    name: "extract_supplier_offers",
    description: "Re-run AI extraction over every supplier thread on a SOURCING inquiry. Updates the persisted offer parsing.",
    input_schema: {
      type: "object",
      properties: { inquiry_id: { type: "string" } },
    },
  },
  {
    name: "edit_job",
    description: "Create a human-review proposal to update fields on a job. Does not mutate immediately. ANY of these can be proposed: origin, destination, mode (SEA-FCL/SEA-LCL/AIR/ROAD/COURIER), incoterms, commodity, containerCount, containerType, stackable (YES/NO/UNKNOWN), topLoad, dangerousGoods, customsBy, targetPrice, targetCurrency, targetPriceStatus, targetPriceSource, weight (kg), volume (cbm), packages, dimensions JSON [{qty,length,width,height}] in cm, etd (YYYY-MM-DD), eta, currency (USD/EUR/GBP/TRY), notes.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        fields: { type: "object", description: "Fields to update" },
      },
      required: ["fields"],
    },
  },
  {
    name: "edit_inquiry",
    description: "Create a human-review proposal to update fields on the linked inquiry/RFQ: origin, destination, mode, incoterms, commodity, containerCount, containerType, stackable, topLoad, dangerousGoods, customsBy, targetPrice, targetCurrency, targetPriceStatus, targetPriceSource, weight, volume, packages, dimensions JSON [{qty,length,width,height}] in cm, subject, fromEmail, fromCompany. Does not mutate immediately.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Edits the inquiry linked to this job" },
        fields: { type: "object" },
      },
      required: ["fields"],
    },
  },
  {
    name: "move_job_stage",
    description: "Create a human-review proposal to change a job's status. Valid statuses: PROPOSED, INQUIRY, QUOTED, BOOKED, IN_TRANSIT, DELIVERED, CANCELLED. Does not mutate immediately.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        status: { type: "string" },
      },
      required: ["status"],
    },
  },
  {
    name: "add_milestone",
    description: "Create a human-review proposal to add or update a high-level workflow milestone. Type one of: BOOKING, CARGO_READY, DELIVERY. Does not mutate immediately.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        type: { type: "string" },
        planned_at: { type: "string", description: "YYYY-MM-DD" },
        actual_at: { type: "string", description: "YYYY-MM-DD when this milestone was actually hit" },
        note: { type: "string" },
      },
      required: ["type"],
    },
  },
  {
    name: "set_customer",
    description: "Create a human-review proposal to link a customer (Company) to a job. The proposal can create the company on apply if it doesn't exist. Does not mutate immediately.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        company_name: { type: "string" },
        create_if_missing: { type: "boolean", description: "Default true" },
      },
      required: ["company_name"],
    },
  },
  {
    name: "rename_job",
    description: "Create a human-review proposal to rename / re-title a job. The job's reference (e.g. JOB-2026-003) is the immutable ID - you cannot change it - but you CAN propose changing the displayed deal name by updating the linked Inquiry's subject. Does not mutate immediately.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Defaults to focused job" },
        new_title: { type: "string", description: "New deal name / subject" },
      },
      required: ["new_title"],
    },
  },
  {
    name: "rename_company",
    description: "Create a human-review proposal to rename the customer/company already linked to a job. Affects every job linked to this customer when applied. Does not mutate immediately.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        new_name: { type: "string" },
      },
      required: ["new_name"],
    },
  },
  {
    name: "set_revenue",
    description: "Create a human-review proposal to set the customer-facing revenue (price quoted to customer) on a job. Does not mutate immediately.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        amount: { type: "number" },
        currency: { type: "string", enum: ["USD", "EUR", "GBP", "TRY"] },
      },
      required: ["amount"],
    },
  },
  {
    name: "set_cost",
    description: "Create a human-review proposal to set the cost (carrier/supplier expense) on a job. Does not mutate immediately.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        amount: { type: "number" },
        currency: { type: "string", enum: ["USD", "EUR", "GBP", "TRY"] },
      },
      required: ["amount"],
    },
  },
  {
    name: "add_quote_line",
    description: "Create a human-review proposal to append a line item (description + amount) to a job's quote. Does not mutate immediately.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        description: { type: "string" },
        amount: { type: "number" },
        currency: { type: "string", enum: ["USD", "EUR", "GBP", "TRY"] },
      },
      required: ["description", "amount"],
    },
  },
  {
    name: "hide_unrelated_threads",
    description: "Create a human-review proposal to hide likely unrelated unlinked inbox threads. Does not mutate immediately.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Maximum threads to propose, default 25." },
      },
    },
  },
  {
    name: "link_threads_to_job",
    description: "Find email threads matching a query and link them all to the focused job's inquiry. If `q` is omitted, the tool derives search terms automatically from the job itself (commodity name, origin/destination, customer name, customer email domain). Use this when the operator says 'attach related emails', 'why aren't offers showing up', 'find related threads', or 'pull in the supplier emails for this load'.",
    input_schema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Optional override search query. Leave empty to auto-derive from the job's commodity/route/customer." },
        job_id: { type: "string", description: "Defaults to focused job" },
        only_unlinked: { type: "boolean", description: "Default true - skip threads already linked elsewhere" },
        limit: { type: "number", description: "Max threads to link, default 50" },
      },
    },
  },
  {
    name: "ask_about_document",
    description: "Answer a free-form question about a specific JobDocument by reading its PDF content (or cached AI summary if PDF text is unavailable). Use when the operator asks 'what's the BL number', 'when does the LC expire', 'is the consignee correct on the invoice', etc.",
    input_schema: {
      type: "object",
      properties: {
        document_id: { type: "string" },
        question: { type: "string" },
      },
      required: ["document_id", "question"],
    },
  },
  {
    name: "analyze_document",
    description: "Re-run AI analysis on a JobDocument: fetches the PDF, extracts text, generates a 1-3 sentence summary + flags any discrepancies + extracts key fields (BL number, weights, dates). Use when operator approves a doc or asks 'what does this BL say' / 'are there issues with this invoice'.",
    input_schema: {
      type: "object",
      properties: {
        document_id: { type: "string" },
        force: { type: "boolean", description: "Re-analyze even if already done recently" },
      },
      required: ["document_id"],
    },
  },
  {
    name: "delete_job",
    description: "Permanently delete a job. ONLY call this when the user explicitly says delete/remove/kill. Destructive.",
    input_schema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        confirm: { type: "boolean" },
      },
      required: ["confirm"],
    },
  },
] as const;

// ─── Dispatcher ──────────────────────────────────────────────────────────────

export type ToolContext = {
  officeId: string;
  userId?: string;
  scopeJobId?: string;
  scopeCompanyId?: string;
};

type BlockerSeverity = "critical" | "warning" | "info";

type ProposalFieldKind = "string" | "number" | "date";

const JOB_PROPOSAL_FIELDS: Record<string, ProposalFieldKind> = {
  origin: "string",
  destination: "string",
  mode: "string",
  incoterms: "string",
  commodity: "string",
  containerType: "string",
  dimensions: "string",
  stackable: "string",
  topLoad: "string",
  dangerousGoods: "string",
  customsBy: "string",
  targetCurrency: "string",
  targetPriceStatus: "string",
  targetPriceSource: "string",
  currency: "string",
  notes: "string",
  weight: "number",
  volume: "number",
  containerCount: "number",
  packages: "number",
  targetPrice: "number",
  revenue: "number",
  cost: "number",
  etd: "date",
  eta: "date",
};

const INQUIRY_PROPOSAL_FIELDS: Record<string, ProposalFieldKind> = {
  origin: "string",
  destination: "string",
  mode: "string",
  incoterms: "string",
  commodity: "string",
  containerType: "string",
  dimensions: "string",
  stackable: "string",
  topLoad: "string",
  dangerousGoods: "string",
  customsBy: "string",
  targetCurrency: "string",
  targetPriceStatus: "string",
  targetPriceSource: "string",
  subject: "string",
  fromEmail: "string",
  fromCompany: "string",
  weight: "number",
  volume: "number",
  containerCount: "number",
  packages: "number",
  targetPrice: "number",
};

const JOB_TO_INQUIRY_MIRROR_FIELDS = new Set([
  "origin", "destination", "mode", "incoterms", "commodity", "weight", "volume", "packages", "dimensions",
  "containerCount", "containerType", "stackable", "topLoad", "dangerousGoods", "customsBy",
  "targetPrice", "targetCurrency", "targetPriceStatus", "targetPriceSource",
]);

const PROPOSAL_FIELD_LABELS: Record<string, string> = {
  origin: "Origin",
  destination: "Destination",
  mode: "Mode",
  incoterms: "Incoterms",
  commodity: "Commodity",
  containerType: "Container type",
  stackable: "Stackable",
  topLoad: "Top load",
  dangerousGoods: "Dangerous goods",
  customsBy: "Customs by",
  targetCurrency: "Target currency",
  targetPriceStatus: "Target status",
  targetPriceSource: "Target source",
  currency: "Currency",
  notes: "Notes",
  weight: "Weight kg",
  volume: "Volume cbm",
  dimensions: "Dimensions",
  containerCount: "Containers",
  packages: "Packages",
  targetPrice: "Target price",
  revenue: "Revenue",
  cost: "Cost",
  etd: "ETD",
  eta: "ETA",
  status: "Status",
  quoteLines: "Quote lines",
  subject: "Deal title",
  fromEmail: "RFQ sender email",
  fromCompany: "RFQ sender company",
};

function sanitizeProposalFields(fields: Record<string, unknown>, allowed: Record<string, ProposalFieldKind>) {
  const update: Record<string, unknown> = {};
  for (const [field, kind] of Object.entries(allowed)) {
    const value = fields[field];
    if (value == null || value === "") continue;
    if (kind === "number") {
      const numberValue = Number(value);
      if (Number.isFinite(numberValue)) update[field] = numberValue;
      continue;
    }
    if (kind === "date") {
      const date = new Date(String(value));
      if (!Number.isNaN(date.getTime())) update[field] = date.toISOString();
      continue;
    }
    update[field] = String(value).slice(0, field === "notes" ? 4000 : 300);
  }
  return update;
}

function proposalToolTrace(toolName: string, input: Record<string, unknown>) {
  return {
    toolName,
    requestedInput: input,
    appliedImmediately: false,
    requiresHumanReview: true,
  };
}

async function createToolUpdateProposal(args: {
  ctx: ToolContext;
  jobId: string;
  kind: string;
  sourcePreview: string;
  update?: Record<string, unknown>;
  inquiryUpdate?: Record<string, unknown>;
  toolName: string;
  input: Record<string, unknown>;
}) {
  const result = await createPendingJobUpdateProposal({
    officeId: args.ctx.officeId,
    userId: args.ctx.userId,
    jobId: args.jobId,
    kind: args.kind,
    sourceType: "AGENT_TOOL",
    sourcePreview: args.sourcePreview,
    update: args.update,
    inquiryUpdate: args.inquiryUpdate,
    fieldLabels: PROPOSAL_FIELD_LABELS,
    toolTrace: proposalToolTrace(args.toolName, args.input),
  });
  return result.ok ? { ok: true as const, result } : { ok: false as const, error: result.error };
}

async function createToolActionProposal(args: {
  ctx: ToolContext;
  jobId: string;
  kind: string;
  action: "ADD_MILESTONE" | "SET_CUSTOMER" | "RENAME_COMPANY" | "AWARD_SUPPLIER" | "LINK_THREADS_TO_JOB";
  actionInput: Record<string, unknown>;
  actionLabel: string;
  actionDetails?: string[];
  sourcePreview: string;
  toolName: string;
  input: Record<string, unknown>;
}) {
  const result = await createPendingJobActionProposal({
    officeId: args.ctx.officeId,
    userId: args.ctx.userId,
    jobId: args.jobId,
    kind: args.kind,
    action: args.action,
    actionInput: args.actionInput,
    actionLabel: args.actionLabel,
    actionDetails: args.actionDetails,
    sourceType: "AGENT_TOOL",
    sourcePreview: args.sourcePreview,
    toolTrace: proposalToolTrace(args.toolName, args.input),
  });
  return result.ok ? { ok: true as const, result } : { ok: false as const, error: result.error };
}

function compactDocumentReadinessForAgent(docs: Array<{
  id: string;
  name: string;
  status: string;
  docType?: string | null;
  aiSummary?: string | null;
  aiFlags?: string | null;
  aiKeyFields?: string | null;
}>) {
  const readiness = buildDocumentReadiness(docs);
  return {
    status: readiness.tone,
    label: readiness.label,
    metric: readiness.metric,
    detail: readiness.detail,
    approved: readiness.approved,
    uploaded: readiness.uploaded,
    pending: readiness.pending,
    analyzed: readiness.analyzed,
    extracted_fields: readiness.extractedFields,
    flags: readiness.flags,
  };
}

function daysSince(d: Date | null | undefined): number | null {
  if (!d) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000));
}

function money(amount: number | null | undefined, currency = "USD"): string | null {
  if (amount == null || Number.isNaN(amount)) return null;
  return `${currency} ${amount.toLocaleString()}`;
}

function parseSupplierOffer(raw: string | null | undefined): {
  supplier?: string;
  price?: number;
  currency?: string;
  unit?: string;
} {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return {
      supplier: parsed.supplierName,
      price: typeof parsed.pricePerUnit === "number" ? parsed.pricePerUnit : undefined,
      currency: parsed.currency,
      unit: parsed.unit,
    };
  } catch {
    return {};
  }
}

async function loadJobForAgent(jobId: string, officeId: string) {
  return prisma.job.findFirst({
    where: { id: jobId, officeId },
    include: {
      company: { select: { id: true, name: true } },
      inquiry: {
        include: {
          carrierQuotes: { orderBy: { createdAt: "asc" } },
          emailThreads: {
            include: { messages: { orderBy: { sentAt: "desc" }, take: 1 } },
            orderBy: { lastMessageAt: "desc" },
          },
        },
      },
      documents: { orderBy: { createdAt: "asc" } },
      milestones: { orderBy: { createdAt: "asc" } },
      emailThreads: {
        include: { messages: { orderBy: { sentAt: "desc" }, take: 1 } },
        orderBy: { lastMessageAt: "desc" },
      },
      children: { select: { id: true, reference: true, type: true, status: true } },
    },
  });
}

function buildReadiness(job: NonNullable<Awaited<ReturnType<typeof loadJobForAgent>>>, goalInput?: string) {
  const goal = (goalInput && goalInput !== "GENERAL")
    ? goalInput
    : job.status === "INQUIRY" ? "QUOTE"
    : job.status === "QUOTED" ? "BOOK"
    : job.status === "BOOKED" ? "SHIP"
    : job.status === "IN_TRANSIT" || job.status === "CUSTOMS" ? "DELIVER"
    : "GENERAL";

  const blockers: { severity: BlockerSeverity; area: string; issue: string; fix: string }[] = [];
  const wins: string[] = [];
  const missing: string[] = [];

  const requireField = (ok: boolean, label: string, fix: string, severity: BlockerSeverity = "critical") => {
    if (ok) {
      wins.push(`${label} set`);
    } else {
      missing.push(label);
      blockers.push({ severity, area: "Job data", issue: `${label} is missing`, fix });
    }
  };

  requireField(!!job.company, "Customer", "Set the customer on the job.");
  requireField(!!job.origin, "Origin", "Populate the origin from the RFQ or email thread.");
  requireField(!!job.destination, "Destination", "Populate the destination from the RFQ or email thread.");
  requireField(!!job.mode, "Mode", "Set the transport mode.");
  requireField(!!job.commodity, "Commodity", "Set the cargo or product.");

  if (job.mode === "SEA-FCL") {
    requireField(!!job.containerCount && !!job.containerType, "Container equipment", "Set container count and type.");
  } else {
    requireField(!!job.weight || !!job.volume || !!job.dimensions, "Cargo size", "Set weight, volume, or dimensions.");
  }

  const rfqQualification = qualifyRfq({
    origin: job.origin,
    destination: job.destination,
    mode: job.mode,
    commodity: job.commodity,
    containerCount: job.containerCount,
    containerType: job.containerType,
    dimensions: job.dimensions,
    stackable: job.stackable,
    topLoad: job.topLoad,
    dangerousGoods: job.dangerousGoods,
    customsBy: job.customsBy,
    weight: job.weight,
    volume: job.volume,
    targetPrice: job.targetPrice,
    targetPriceStatus: job.targetPriceStatus,
  });
  if ((goal === "QUOTE" || goal === "GENERAL") && !rfqQualification.isMature) {
    for (const field of rfqQualification.missing) {
      blockers.push({
        severity: "critical",
        area: "RFQ qualification",
        issue: `${field} is missing`,
        fix: `Ask the customer to confirm ${field} before sending this RFQ to forwarders.`,
      });
    }
    if (rfqQualification.targetPriceQuestion) {
      blockers.push({
        severity: "warning",
        area: "RFQ qualification",
        issue: "Target price has not been answered",
        fix: rfqQualification.targetPriceQuestion,
      });
    }
  } else if (rfqQualification.isMature) {
    wins.push("RFQ qualification complete");
  }

  const documentReadiness = buildDocumentReadiness(job.documents);
  const compactDocumentReadiness = compactDocumentReadinessForAgent(job.documents);
  const docFlags = job.documents.flatMap((d) => {
    if (!d.aiFlags) return [];
    try {
      const flags = JSON.parse(d.aiFlags);
      return Array.isArray(flags) ? flags.map((f) => `${d.name}: ${String(f)}`) : [];
    } catch {
      return [];
    }
  });

  if (job.documents.length > 0) {
    wins.push(`Document proof: ${documentReadiness.metric} (${documentReadiness.label})`);
  }
  if (documentReadiness.uploaded > 0) {
    blockers.push({
      severity: "warning",
      area: "Documents",
      issue: `${documentReadiness.uploaded} uploaded document${documentReadiness.uploaded === 1 ? "" : "s"} still need approval`,
      fix: "Review and approve the uploaded docs.",
    });
  }
  for (const flag of docFlags.slice(0, 5)) {
    blockers.push({ severity: "warning", area: "Documents", issue: flag, fix: "Open the document analysis and resolve the discrepancy." });
  }

  const carrierQuotes = job.inquiry?.carrierQuotes ?? [];
  const receivedRates = carrierQuotes.filter((q) => q.status === "RECEIVED");
  const supplierThreads = job.inquiry?.emailThreads ?? [];
  const supplierOffers = supplierThreads.map((t) => ({ thread: t, offer: parseSupplierOffer(t.supplierOffer) }));
  const pricedSupplierOffers = supplierOffers.filter((x) => typeof x.offer.price === "number");

  if (job.type === "SOURCING") {
    if (pricedSupplierOffers.length > 0) {
      const best = pricedSupplierOffers.sort((a, b) => (a.offer.price ?? Infinity) - (b.offer.price ?? Infinity))[0];
      wins.push(`${pricedSupplierOffers.length} priced supplier offer${pricedSupplierOffers.length === 1 ? "" : "s"}; best ${best.offer.supplier ?? best.thread.subject} at ${money(best.offer.price, best.offer.currency ?? job.currency) ?? "priced"}`);
    } else if (goal === "QUOTE" || goal === "BOOK" || goal === "GENERAL") {
      blockers.push({
        severity: "critical",
        area: "Supplier offers",
        issue: "No priced supplier offer is attached",
        fix: "Run link_threads_to_job, then extract_supplier_offers, or ask suppliers for firm pricing.",
      });
    }
    if (!job.children.length && (job.status === "BOOKED" || job.status === "IN_TRANSIT")) {
      blockers.push({
        severity: "warning",
        area: "Sourcing handoff",
        issue: "No child forwarding job exists for the awarded supplier",
        fix: "Award the supplier so the forwarding job is created.",
      });
    }
  } else {
    if (receivedRates.length > 0) {
      const best = [...receivedRates].sort((a, b) => {
        const av = a.total40HC ?? a.total40 ?? a.total20 ?? Infinity;
        const bv = b.total40HC ?? b.total40 ?? b.total20 ?? Infinity;
        return av - bv;
      })[0];
      const bestTotal = best.total40HC ?? best.total40 ?? best.total20;
      wins.push(`${receivedRates.length}/${carrierQuotes.length} carrier rates received${bestTotal ? `; best ${best.carrier} at ${money(bestTotal, job.currency)}` : ""}`);
    } else if (goal === "QUOTE" || goal === "BOOK" || goal === "GENERAL") {
      blockers.push({
        severity: "critical",
        area: "Carrier rates",
        issue: carrierQuotes.length > 0 ? "Carrier requests are still pending" : "No carrier rates are attached",
        fix: "Request rates or enter a received carrier quote before quoting the customer.",
      });
    }
  }

  if ((goal === "QUOTE" || goal === "BOOK") && !job.revenue && !job.quoteLines) {
    blockers.push({
      severity: "critical",
      area: "Customer quote",
      issue: "No customer-facing quote/revenue is set",
      fix: "Build quote lines or set revenue before moving past pricing.",
    });
  }
  if ((goal === "QUOTE" || goal === "BOOK") && !job.cost) {
    blockers.push({
      severity: "warning",
      area: "Margin",
      issue: "No selected cost is set",
      fix: "Select the winning carrier/supplier cost so margin is real.",
    });
  }
  if (job.revenue && job.cost) {
    const margin = ((job.revenue - job.cost) / job.revenue) * 100;
    wins.push(`Margin ${margin.toFixed(1)}%`);
    if (margin < 8) {
      blockers.push({
        severity: "warning",
        area: "Margin",
        issue: `Margin is thin at ${margin.toFixed(1)}%`,
        fix: "Reprice, counter the vendor, or get manager approval before sending.",
      });
    }
  }

  const milestone = (type: string) => job.milestones.find((m) => m.type === type);
  if ((goal === "SHIP" || goal === "DELIVER") && !milestone("BOOKING")?.actualAt) {
    blockers.push({ severity: "critical", area: "Milestones", issue: "Booking is not confirmed", fix: "Confirm the booking milestone." });
  }
  if (goal === "DELIVER" && !milestone("DELIVERY")?.actualAt) {
    blockers.push({ severity: "critical", area: "Milestones", issue: "Delivery is not confirmed", fix: "Confirm delivery when POD/customer confirmation arrives." });
  }
  const latestThread = [...job.emailThreads, ...(job.inquiry?.emailThreads ?? [])]
    .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())[0];
  const latestMessage = latestThread?.messages?.[0];
  if (latestMessage?.direction === "INBOUND") {
    const age = daysSince(latestMessage.sentAt);
    blockers.push({
      severity: age != null && age >= 2 ? "critical" : "warning",
      area: "Inbox",
      issue: `Latest email on "${latestThread.subject}" is inbound${age != null ? ` from ${age}d ago` : ""}`,
      fix: "Draft a reply or mark why no reply is needed.",
    });
  }

  const critical = blockers.filter((b) => b.severity === "critical").length;
  const warning = blockers.filter((b) => b.severity === "warning").length;
  const score = Math.max(0, Math.min(100, 100 - critical * 22 - warning * 9 - missing.length * 4));
  const status = critical > 0 ? "blocked" : warning > 0 ? "needs_review" : "ready";

  return {
    job: {
      id: job.id,
      reference: job.reference,
      title: job.title,
      type: job.type,
      status: job.status,
      customer: job.company?.name ?? null,
      route: `${job.origin ?? "?"} → ${job.destination ?? "?"}`,
    },
    goal,
    status,
    score,
    missing,
    document_readiness: compactDocumentReadiness,
    blockers,
    wins: wins.slice(0, 8),
  };
}

function actionsFromReadiness(readiness: ReturnType<typeof buildReadiness>, limit: number) {
  const actions = readiness.blockers.map((b, i) => ({
    priority: b.severity === "critical" ? "high" : b.severity === "warning" ? "medium" : "low",
    area: b.area,
    action: b.fix,
    why: b.issue,
    suggested_agent_prompt:
      b.area === "Job data" ? "Populate this job from emails."
      : b.area === "Supplier offers" ? "Attach related supplier emails and summarize offers."
      : b.area === "Carrier rates" ? "Summarize carrier rates for this job."
      : b.area === "Inbox" ? "Draft a reply to the latest inbound email."
      : b.area === "Customer quote" ? "Build a customer quote from the best received rate."
      : b.area === "Documents" ? "Analyze the uploaded documents and list discrepancies."
      : "Help me resolve this blocker.",
    rank: i + 1,
  }));

  if (actions.length === 0) {
    actions.push({
      priority: "low",
      area: "Ops",
      action: "Keep monitoring inbox and milestone updates.",
      why: "No critical blockers were found.",
      suggested_agent_prompt: "Draft a customer update for this job.",
      rank: 1,
    });
  }

  return actions.slice(0, limit).map((a, i) => ({ ...a, rank: i + 1 }));
}

function summarizeDecisionQueue(items: DecisionQueueItem[]) {
  return buildDecisionQueueBrief(items);
}

type CommercialBrainRun =
  | NonNullable<Awaited<ReturnType<typeof assessJobStrategy>>>
  | NonNullable<Awaited<ReturnType<typeof assessInquiryStrategy>>>;

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function recordValue(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

function buildAgentBrainPacket(
  run: CommercialBrainRun,
  entity: { jobId?: string | null; inquiryId?: string | null },
) {
  const compact = compactStrategyForAgent(run.strategy) as Record<string, any>;
  const executionPacket = recordValue(compact.execution_packet);
  const decisionContract = recordValue(compact.decision_contract);
  const decisionQuality = recordValue(compact.decision_quality);
  const commercialPriority = recordValue(compact.commercial_priority);
  const evidence = recordValue(executionPacket?.evidence);
  const commandLedger = arrayValue(executionPacket?.commandLedger).slice(0, 5);
  const proofGaps = arrayValue(evidence?.gaps ?? evidence?.proof_gaps).slice(0, 5);
  const firstGap = recordValue(proofGaps[0]);
  const firstCommand = recordValue(commandLedger[0]);
  const firstChecklist = recordValue(arrayValue(commercialPriority?.checklist)[0]);
  const weakestEvidence = recordValue(evidence?.weakest) ?? firstGap ?? decisionQuality;
  const allowedAgentMoves = arrayValue(decisionContract?.allowedAgentMoves)
    .map(firstText)
    .filter((item): item is string => Boolean(item))
    .slice(0, 4);
  const forbidden = arrayValue(decisionContract?.forbidden)
    .map(firstText)
    .filter((item): item is string => Boolean(item))
    .slice(0, 4);
  const pageTargets = [
    "decision-contract",
    firstText(firstGap?.target),
    firstText(firstChecklist?.target),
    "decision-quality",
    "commercial-priority",
  ].filter((target): target is string => Boolean(target));
  const uniqueTargets = [...new Set(pageTargets)].slice(0, 5);
  const reviewUrl = entity.jobId
    ? `/dashboard/jobs/${entity.jobId}`
    : entity.inquiryId
      ? `/dashboard/rfq/${entity.inquiryId}`
      : "/dashboard/pricing";
  const contractState = firstText(decisionContract?.state);
  const contractTitle = firstText(decisionContract?.title);
  const contractSummary = firstText(decisionContract?.summary);
  const operator = run.strategy.operatorDecision;
  const leadWith = contractState && contractState !== "ready"
    ? [contractTitle, contractSummary].filter(Boolean).join(" - ")
    : operator.title;

  return {
    assessment_id: run.assessmentId,
    created_snapshot: run.created,
    source_of_truth: "commercial_strategy_engine",
    not_mutating: true,
    entity: {
      job_id: entity.jobId ?? null,
      inquiry_id: entity.inquiryId ?? null,
      review_url: reviewUrl,
    },
    agent_answer_contract: {
      lead_with: leadWith || run.strategy.recommendationLabel,
      next_safe_move: allowedAgentMoves[0] ?? operator.command,
      next_command: operator.command,
      owner: operator.owner,
      can_run_now: operator.canRunNow,
      requires_approval: operator.requiresApproval,
      stop_condition: firstText(firstCommand?.stopRule) ?? forbidden[0] ?? "Stop before any external send or record mutation that has not produced a reviewed artifact.",
      weakest_proof: weakestEvidence ? {
        label: firstText(weakestEvidence.label) ?? "Weakest proof",
        metric: firstText(weakestEvidence.metric),
        detail: firstText(weakestEvidence.detail),
        target: firstText(weakestEvidence.target),
      } : null,
      proof_gap_count: proofGaps.length,
      allowed_agent_moves: allowedAgentMoves,
      forbidden,
      external_send_policy: "Draft/review only from chat. Do not send customer, forwarder, WhatsApp, or Gmail messages unless a dedicated reviewed-send flow and credentials are explicitly present.",
      answer_order: [
        "Decision contract",
        "Weakest proof gap",
        "Next safe move",
        "Why this matters commercially",
        "Review-only artifact or exact human ask",
      ],
    },
    page_evidence_targets: uniqueTargets,
    proof_gaps: proofGaps,
    command_ledger: commandLedger,
    ...compact,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonString(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function jsonNumber(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function jsonBoolean(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "boolean" ? value : null;
}

function jsonRecord(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  return isRecord(value) ? value : null;
}

function hoursSinceDate(value: Date | string | null | undefined) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 0;
  return Math.max(0, (Date.now() - date.getTime()) / 36e5);
}

function priorityRank(value: string | null | undefined) {
  if (value === "critical") return 4;
  if (value === "high") return 3;
  if (value === "medium") return 2;
  if (value === "low") return 1;
  return 2;
}

function pricingCommandRankFromBrief(brief: Record<string, unknown> | null, createdAt: Date) {
  if (!brief) return hoursSinceDate(createdAt) * 0.2;
  const nextAction = isRecord(brief.nextAction) ? brief.nextAction : null;
  const economics = isRecord(brief.economics) ? brief.economics : null;
  const phase = jsonString(brief, "phase");
  const gateStatus = jsonString(brief, "gateStatus");
  const priority = jsonString(nextAction, "priority");
  const guardrail = jsonString(economics, "guardrailStatus");
  const score = jsonNumber(brief, "score") ?? 0;
  const phaseWeight: Record<string, number> = {
    QUOTE_CUSTOMER: 520,
    APPROVE_ECONOMICS: 480,
    GET_RATES: 440,
    MATURE_RFQ: 420,
    PARK_DEAL: 80,
  };
  const gateWeight: Record<string, number> = {
    READY_TO_QUOTE: 170,
    REVIEW_REQUIRED: 135,
    NEEDS_RATES: 110,
    BLOCKED: 85,
  };
  const guardrailWeight: Record<string, number> = {
    PASS: 70,
    REVIEW: 55,
    NEEDS_COST: 35,
    BLOCKED: 20,
  };
  return (phaseWeight[phase ?? ""] ?? 120)
    + (priorityRank(priority) * 45)
    + (gateWeight[gateStatus ?? ""] ?? 70)
    + (guardrailWeight[guardrail ?? ""] ?? 35)
    + score
    + Math.min(70, hoursSinceDate(createdAt) / 4);
}

function fallbackPricingSafetyRule(args: {
  phase?: string | null;
  gateStatus?: string | null;
  requiresApproval?: boolean | null;
}) {
  if (args.gateStatus === "BLOCKED" || args.phase === "MATURE_RFQ") {
    return "Do not send to forwarders or quote the customer until these RFQ facts are explicit.";
  }
  if (args.gateStatus === "NEEDS_RATES" || args.phase === "GET_RATES") {
    return "Create reviewed drafts only; do not externally send rate requests without operator approval.";
  }
  if (args.gateStatus === "REVIEW_REQUIRED" || args.phase === "APPROVE_ECONOMICS" || args.requiresApproval) {
    return "Do not quote the customer until the margin or risk exception is approved.";
  }
  if (args.gateStatus === "READY_TO_QUOTE" || args.phase === "QUOTE_CUSTOMER") {
    return "Draft the customer quote for review; never send externally without user approval.";
  }
  return "Prepare the next artifact for review; do not send anything externally without user approval.";
}

function fallbackPricingStopCondition(args: {
  phase?: string | null;
  requiresApproval?: boolean | null;
  blockers?: unknown[];
}) {
  if (args.requiresApproval) return "Stop after preparing the artifact and wait for approval.";
  if (args.phase === "MATURE_RFQ" && args.blockers?.length) {
    return "Stop after drafting the missing-info request; wait for the customer facts before forwarding or quoting.";
  }
  return "Stop after creating the review draft; no external side effects.";
}

function normalizeStrategyEvidenceTone(value: string | null | undefined): StrategyEvidenceCheck["tone"] {
  if (value === "ready" || value === "review" || value === "blocked" || value === "info") return value;
  return "review";
}

function cachedDecisionQuality(args: {
  brief: Record<string, unknown> | null;
  components: unknown;
  gateStatus: string | null;
  stale: boolean;
  blockerCount: number;
  guardrailStatus: string | null;
  receivedQuotes: number;
}): StrategyEvidenceCheck {
  const fromBrief = jsonRecord(args.brief, "decisionQuality");
  if (fromBrief) {
    return {
      key: "decision_quality",
      label: jsonString(fromBrief, "label") ?? "Decision quality",
      tone: normalizeStrategyEvidenceTone(jsonString(fromBrief, "tone")),
      metric: operatorMetricLabel(jsonString(fromBrief, "metric") ?? "unknown", jsonString(fromBrief, "tone")),
      detail: jsonString(fromBrief, "detail") ?? "Decision-quality detail was not captured in this snapshot.",
    };
  }

  const confidenceScore = isRecord(args.components) && typeof args.components.confidence === "number"
    ? Math.max(0, Math.min(100, Math.round(args.components.confidence)))
    : null;
  const weakInputs = [
    args.stale ? "snapshot is stale" : null,
    args.blockerCount > 0 ? `${args.blockerCount} RFQ blocker${args.blockerCount === 1 ? "" : "s"}` : null,
    args.gateStatus === "NEEDS_RATES" || args.receivedQuotes === 0 ? "live rates are missing" : null,
    args.guardrailStatus && args.guardrailStatus !== "PASS" ? `guardrail is ${args.guardrailStatus.toLowerCase().replace("_", " ")}` : null,
  ].filter((item): item is string => Boolean(item));
  const tone =
    args.gateStatus === "BLOCKED" || (confidenceScore != null && confidenceScore < 40)
      ? "blocked"
      : weakInputs.length > 0 || (confidenceScore != null && confidenceScore < 68)
        ? "review"
        : "ready";

  return {
    key: "decision_quality",
    label: "Decision quality",
    tone,
    metric: confidenceScore == null ? "cached" : operatorMetricLabel(`${confidenceScore}/100`, tone),
    detail: weakInputs.length > 0
      ? `Cached snapshot can change because ${weakInputs.slice(0, 4).join("; ")}. Refresh strategy if this is about to become customer-facing.`
      : "Cached decision has enough proof for the current next step.",
  };
}

function latestStrategyInputAt(row: {
  createdAt: Date;
  inquiry?: { updatedAt: Date; carrierQuotes?: Array<{ updatedAt: Date }> } | null;
  job?: { updatedAt: Date } | null;
}) {
  const dates = [row.inquiry?.updatedAt, row.job?.updatedAt, ...(row.inquiry?.carrierQuotes ?? []).map((q) => q.updatedAt)]
    .filter((date): date is Date => date instanceof Date);
  return dates.reduce((latest, date) => (date.getTime() > latest.getTime() ? date : latest), row.createdAt);
}

function routeEvidenceString(evidence: unknown, key: string) {
  return isRecord(evidence) ? jsonString(evidence, key) : null;
}

function routeEvidenceBoolean(evidence: unknown, key: string) {
  return isRecord(evidence) ? jsonBoolean(evidence, key) : null;
}

function cachedRouteDecision(routeOptions: Array<{
  label: string;
  provider: string | null;
  source: string;
  cost: number | null;
  currency: string;
  transitDays: number | null;
  reliabilityScore: number;
  riskScore: number;
  confidence: string;
  tradeoff: string;
  evidence: unknown;
}>, gateStatus: string | null) {
  const rows = routeOptions.slice(0, 6).map((option, index) => {
    const rateFreshnessStatus = routeEvidenceString(option.evidence, "rateFreshnessStatus");
    const rateReliable = routeEvidenceBoolean(option.evidence, "rateReliable");
    return {
      rank: index + 1,
      label: option.label,
      provider: option.provider,
      source: option.source,
      cost: option.cost,
      currency: option.currency,
      cost_label: money(option.cost, option.currency) ?? "unknown",
      transit_days: option.transitDays,
      confidence: option.confidence,
      reliability_score: option.reliabilityScore,
      risk_score: option.riskScore,
      rate_freshness_status: rateFreshnessStatus,
      rate_reliable: rateReliable,
      tradeoff: option.tradeoff,
    };
  });
  const selected = rows[0] ?? null;
  const canQuoteCustomer = gateStatus === "READY_TO_QUOTE";
  const liveSelected = selected?.source === "RECEIVED_QUOTE" && selected.rate_reliable === true;
  const summary =
    !selected
      ? "No priced route exists; request current forwarder rates."
      : !canQuoteCustomer
        ? `${selected.label} is the current best route evidence, but the quote gate is ${gateStatus ?? "unknown"}.`
        : liveSelected
          ? `${selected.label} is selected because it is a usable received forwarder quote.`
          : `${selected.label} is selected as context only; verify a live forwarder quote before customer-facing use.`;

  return {
    selected,
    alternatives: rows.slice(1),
    quote_gate_status: gateStatus,
    can_quote_customer: canQuoteCustomer,
    summary,
    selection_rule: "Rank current reliable received quotes first, then lane benchmarks, then historical costs, then stale or unverified quotes.",
  };
}

function cachedPricingCommandLedger(args: {
  gateStatus: string | null;
  blockerCount: number;
  firstBlockerAsk: string | null;
  guardrailStatus: string | null;
  buyCost: number | null;
  floorPrice: number | null;
  recommendedPrice: number | null;
  currency: string | null;
  routeDecision: ReturnType<typeof cachedRouteDecision>;
  coverageLabel: string | null;
  playbookObjective: string | null;
  playbookFirstMove: string | null;
  playbookSafetyRule: string;
  playbookStopCondition: string;
  playbookToolHint: string | null;
  decisionOwner: string | null;
  decisionPriority: string | null;
}) {
  const gateBlocked = args.gateStatus === "BLOCKED";
  const needsRates = args.gateStatus === "NEEDS_RATES";
  const reviewRequired = args.gateStatus === "REVIEW_REQUIRED";
  const guardrailBlocked = args.guardrailStatus === "BLOCKED";
  const guardrailReview = args.guardrailStatus === "REVIEW";
  const routeSelected = args.routeDecision.selected;
  return [
    {
      key: "rfq_gate",
      label: "RFQ gate",
      owner: gateBlocked ? "CUSTOMER" : "INTERNAL",
      priority: gateBlocked ? "critical" : "medium",
      tone: gateBlocked ? "blocked" : "ready",
      command: args.firstBlockerAsk ?? (gateBlocked ? "Clear missing RFQ facts before pricing or forwarding." : "RFQ facts can move to the current commercial step."),
      evidence: gateBlocked
        ? `${args.blockerCount} maturity blocker${args.blockerCount === 1 ? "" : "s"} remain.`
        : `Quote gate is ${args.gateStatus ?? "unknown"}.`,
      stopRule: gateBlocked
        ? "Stop before forwarder send or customer quote."
        : "RFQ facts can move to the current commercial step.",
    },
    {
      key: "price_posture",
      label: "Price posture",
      owner: "INTERNAL",
      priority: guardrailBlocked ? "critical" : guardrailReview ? "high" : "medium",
      tone: guardrailBlocked ? "blocked" : guardrailReview ? "review" : "ready",
      command: guardrailBlocked || guardrailReview
        ? "Review economics before any customer-facing quote."
        : "Protect the floor price in any reviewed customer quote.",
      evidence: `Guardrail ${args.guardrailStatus ?? "unknown"}; buy ${money(args.buyCost, args.currency ?? undefined)}, floor ${money(args.floorPrice, args.currency ?? undefined)}, recommended ${money(args.recommendedPrice, args.currency ?? undefined)}.`,
      stopRule: args.guardrailStatus === "PASS"
        ? "Do not discount below floor."
        : "Stop before customer quote until economics are reviewed.",
    },
    {
      key: "route_proof",
      label: "Route proof",
      owner: "FORWARDER",
      priority: needsRates ? "high" : "medium",
      tone: gateBlocked || (!args.routeDecision.can_quote_customer && !needsRates) ? "blocked" : needsRates ? "review" : "ready",
      command: gateBlocked
        ? "Do not request rates yet; clear RFQ gate before forwarding this load."
        : needsRates
          ? "Create reviewed forwarder draft requests for live rates."
          : args.routeDecision.summary,
      evidence: `${args.coverageLabel ?? "Coverage unknown"}; selected ${routeSelected?.label ?? "none"} at ${routeSelected?.cost_label ?? "unknown"}.`,
      stopRule: gateBlocked
        ? "Stop before forwarder send until RFQ gate clears."
        : args.routeDecision.can_quote_customer
          ? "Route evidence can support a reviewed customer quote."
          : "Do not quote customer from benchmark, stale, or thin route proof.",
    },
    {
      key: "agent_artifact",
      label: "Agent artifact",
      owner: args.decisionOwner ?? "INTERNAL",
      priority: args.decisionPriority ?? "medium",
      tone: reviewRequired || guardrailReview ? "review" : gateBlocked || guardrailBlocked ? "blocked" : "ready",
      command: args.playbookFirstMove ?? "Create the next review artifact.",
      evidence: args.playbookObjective ?? "No cached objective available.",
      stopRule: args.playbookStopCondition || args.playbookSafetyRule,
      toolHint: args.playbookToolHint,
    },
  ];
}

function cachedPricingDecisionContract(args: {
  gateStatus: string | null;
  blockerCount: number;
  firstBlockerAsk: string | null;
  guardrailStatus: string | null;
  requiresApproval: boolean | null;
  canRunNow: boolean | null;
  playbookObjective: string | null;
  playbookFirstMove: string | null;
  playbookSafetyRule: string;
  playbookStopCondition: string;
  decisionQuality: StrategyEvidenceCheck;
  stale: boolean;
}) {
  const blocked = args.gateStatus === "BLOCKED"
    || args.guardrailStatus === "BLOCKED"
    || args.decisionQuality.tone === "blocked"
    || args.canRunNow === false
    || args.blockerCount > 0;
  const review = !blocked && (
    args.stale
    || args.gateStatus === "NEEDS_RATES"
    || args.gateStatus === "REVIEW_REQUIRED"
    || args.guardrailStatus === "REVIEW"
    || args.guardrailStatus === "NEEDS_COST"
    || args.requiresApproval === true
    || args.decisionQuality.tone === "review"
  );
  const state = blocked ? "blocked" : review ? "review" : "ready";
  const label = args.playbookObjective ?? args.playbookFirstMove ?? "next pricing action";
  const firstBlocker = args.firstBlockerAsk
    ?? (args.blockerCount > 0 ? `${args.blockerCount} RFQ blocker${args.blockerCount === 1 ? "" : "s"} must clear.` : null);

  return {
    state,
    title: state === "blocked"
      ? "Contract blocks queue execution"
      : state === "review"
        ? "Contract allows review only"
        : "Contract ready for reviewed action",
    summary: state === "blocked"
      ? `${firstBlocker ?? args.decisionQuality.detail} ${args.playbookStopCondition}`
      : state === "review"
        ? `${label} is allowed as a review artifact; cached proof may still require approval or refresh.`
        : `${label} can be prepared from the cached commercial assessment.`,
    proven: [
      {
        key: "quote_gate",
        label: "Quote gate",
        value: args.gateStatus ?? "unknown",
        detail: args.playbookSafetyRule,
        tone: args.gateStatus === "READY_TO_QUOTE" ? "ready" : args.gateStatus === "NEEDS_RATES" ? "rates" : args.gateStatus === "REVIEW_REQUIRED" ? "review" : "blocked",
      },
      ...(args.decisionQuality.tone === "ready" ? [args.decisionQuality] : []),
    ].slice(0, 4),
    assumptions: [
      args.decisionQuality.tone !== "ready" ? {
        key: args.decisionQuality.key,
        label: args.decisionQuality.label,
        value: args.decisionQuality.metric,
        detail: `${args.decisionQuality.detail} Refresh strategy before using this for customer-facing work.`,
        tone: args.decisionQuality.tone,
      } : null,
      args.stale ? {
        key: "stale_snapshot",
        label: "Snapshot age",
        value: "stale",
        detail: "This pricing command is based on a cached assessment older than the latest RFQ or rate input.",
        tone: "review" as const,
      } : null,
      args.guardrailStatus && args.guardrailStatus !== "PASS" ? {
        key: "guardrail",
        label: "Guardrail",
        value: args.guardrailStatus,
        detail: "Economics are not a clean pass, so customer-facing price work stays review-only.",
        tone: args.guardrailStatus === "BLOCKED" ? "blocked" as const : "review" as const,
      } : null,
    ].filter(Boolean).slice(0, 5),
    allowedAgentMoves: state === "blocked"
      ? [`No agent execution until ${firstBlocker ?? "the listed blockers"} clear.`]
      : [
        `Prepare ${label.toLowerCase()}.`,
        args.requiresApproval ? "Stop at reviewed draft or plan until approval is recorded." : "Stop at review artifact; no external send from the agent.",
      ],
    forbidden: [
      args.gateStatus === "BLOCKED" ? "Do not send to forwarders." : null,
      args.gateStatus === "READY_TO_QUOTE" ? null : "Do not quote the customer.",
      "Do not send external messages from the agent without operator approval.",
      args.requiresApproval ? "Do not execute past the review artifact until approval is recorded." : null,
    ].filter((item): item is string => Boolean(item)),
    nextHumanQuestion: args.firstBlockerAsk ?? (args.requiresApproval ? args.playbookStopCondition : null),
  };
}

async function listPricingCommandsForAgent(officeId: string, args: { limit?: unknown; includeStale?: unknown }) {
  const limit = Math.min(15, Math.max(1, Number(args.limit ?? 8)));
  const includeStale = args.includeStale !== false;
  const [assessments, unassessedOpenRfqs] = await Promise.all([
    prisma.strategyAssessment.findMany({
      where: { officeId, status: "ACTIVE" },
      include: {
        inquiry: {
          select: {
            id: true,
            subject: true,
            status: true,
            origin: true,
            destination: true,
            mode: true,
            updatedAt: true,
            company: { select: { name: true } },
            job: { select: { id: true, reference: true } },
            carrierQuotes: { select: { status: true, updatedAt: true } },
          },
        },
        job: {
          select: {
            id: true,
            reference: true,
            status: true,
            title: true,
            origin: true,
            destination: true,
            mode: true,
            updatedAt: true,
            company: { select: { name: true } },
          },
        },
        routeOptions: {
          orderBy: { createdAt: "asc" },
          take: 6,
        },
      },
      orderBy: { createdAt: "desc" },
      take: 80,
    }),
    prisma.inquiry.count({
      where: {
        officeId,
        status: openInquiryStatusFilter(),
        strategyAssessments: { none: { status: "ACTIVE" } },
      },
    }),
  ]);

  const items = assessments
    .map((assessment) => {
      const brief = isRecord(assessment.decisionBrief) ? assessment.decisionBrief : null;
      const nextAction = isRecord(brief?.nextAction) ? brief.nextAction : null;
      const economics = isRecord(brief?.economics) ? brief.economics : null;
      const route = isRecord(brief?.route) ? brief.route : null;
      const operatorPlaybook = isRecord(brief?.operatorPlaybook) ? brief.operatorPlaybook : null;
      const phase = jsonString(brief, "phase");
      const gateStatus = jsonString(brief, "gateStatus");
      const latestInputAt = latestStrategyInputAt(assessment);
      const stale = assessment.createdAt.getTime() < latestInputAt.getTime();
      if (!includeStale && stale) return null;
      const entity = assessment.inquiry ?? assessment.job;
      const inquiryId = assessment.inquiry?.id ?? null;
      const jobId = assessment.job?.id ?? assessment.inquiry?.job?.id ?? null;
      const reference = assessment.job?.reference ?? assessment.inquiry?.job?.reference ?? null;
      const routeText = `${entity?.origin ?? "?"} → ${entity?.destination ?? "?"}`;
      const blockingQuestions = Array.isArray(brief?.blockingQuestions) ? brief.blockingQuestions.slice(0, 5) : [];
      const firstBlockingQuestion = isRecord(blockingQuestions[0]) ? blockingQuestions[0] : null;
      const blockerCount = jsonNumber(brief, "blockerCount") ?? 0;
      const playbookObjective = jsonString(operatorPlaybook, "objective") ?? jsonString(nextAction, "label") ?? assessment.recommendationLabel;
      const playbookFirstMove = jsonString(operatorPlaybook, "firstMove") ?? jsonString(brief, "nextCommand") ?? assessment.strategyMemo;
      const playbookExactAsk = jsonString(operatorPlaybook, "exactAsk") ?? jsonString(firstBlockingQuestion, "ask");
      const requiresApproval = jsonBoolean(nextAction, "requiresApproval");
      const playbookSafetyRule = jsonString(operatorPlaybook, "safetyRule") ?? fallbackPricingSafetyRule({ phase, gateStatus, requiresApproval });
      const playbookStopCondition = jsonString(operatorPlaybook, "stopCondition") ?? fallbackPricingStopCondition({ phase, requiresApproval, blockers: blockingQuestions });
      const playbookToolHint = jsonString(operatorPlaybook, "toolHint") ?? jsonString(nextAction, "toolHint");
      const canRunNow = jsonBoolean(nextAction, "canRunNow");
      const guardrailStatus = jsonString(economics, "guardrailStatus");
      const band = jsonString(brief, "band") ?? assessment.band;
      const confidence = jsonString(brief, "confidence") ?? assessment.confidence;
      const receivedQuotes = assessment.inquiry?.carrierQuotes.filter((quote) => quote.status === "RECEIVED").length ?? 0;
      const decisionQuality = cachedDecisionQuality({
        brief,
        components: assessment.components,
        gateStatus,
        stale,
        blockerCount,
        guardrailStatus,
        receivedQuotes,
      });
      const routeDecision = cachedRouteDecision(assessment.routeOptions, gateStatus);
      const selectedRoute = routeDecision.selected;
      const buyCost = jsonNumber(economics, "buyCost");
      const floorPrice = jsonNumber(economics, "floorPrice");
      const recommendedPrice = jsonNumber(economics, "recommendedPrice");
      const currency = jsonString(economics, "currency");
      const commandLedger = cachedPricingCommandLedger({
        gateStatus,
        blockerCount,
        firstBlockerAsk: playbookExactAsk,
        guardrailStatus,
        buyCost,
        floorPrice,
        recommendedPrice,
        currency,
        routeDecision,
        coverageLabel: jsonString(brief, "coveragePosture") ?? selectedRoute?.confidence ?? null,
        playbookObjective,
        playbookFirstMove,
        playbookSafetyRule,
        playbookStopCondition,
        playbookToolHint,
        decisionOwner: jsonString(nextAction, "owner"),
        decisionPriority: jsonString(nextAction, "priority"),
      });
      const decisionContract = cachedPricingDecisionContract({
        gateStatus,
        blockerCount,
        firstBlockerAsk: playbookExactAsk,
        guardrailStatus,
        requiresApproval,
        canRunNow,
        playbookObjective,
        playbookFirstMove,
        playbookSafetyRule,
        playbookStopCondition,
        decisionQuality,
        stale,
      });
      const priorityFactors = buildPricingCommandFactors({
        phase,
        blockerCount,
        guardrailStatus,
        receivedQuotes,
        band,
        confidence,
        decisionQuality,
        stale,
      });
      return {
        assessment_id: assessment.id,
        rank_score: pricingCommandRankFromBrief(brief, assessment.createdAt) - (stale ? 25 : 0),
        stale,
        snapshot_created_at: assessment.createdAt,
        latest_input_at: latestInputAt,
        entity: {
          type: assessment.entityType,
          inquiry_id: inquiryId,
          job_id: jobId,
          reference,
          subject: assessment.inquiry?.subject ?? assessment.job?.title ?? assessment.subject,
          customer: assessment.inquiry?.company?.name ?? assessment.job?.company?.name ?? null,
          status: assessment.inquiry?.status ?? assessment.job?.status ?? null,
          route: routeText,
          mode: entity?.mode ?? null,
          review_url: jobId ? `/dashboard/jobs/${jobId}` : inquiryId ? `/dashboard/rfq/${inquiryId}` : "/dashboard/pricing",
        },
        decision: {
          phase,
          verdict: jsonString(brief, "verdict") ?? assessment.recommendationLabel,
          command: jsonString(brief, "nextCommand") ?? assessment.strategyMemo,
          action_label: jsonString(nextAction, "label"),
          action_type: jsonString(nextAction, "actionType"),
          priority: jsonString(nextAction, "priority"),
          owner: jsonString(nextAction, "owner"),
          tool_hint: jsonString(nextAction, "toolHint"),
          can_run_now: canRunNow,
          requires_approval: jsonBoolean(nextAction, "requiresApproval"),
        },
        operator_playbook: {
          objective: playbookObjective,
          first_move: playbookFirstMove,
          exact_ask: playbookExactAsk,
          evidence_gap: jsonString(operatorPlaybook, "evidenceGap"),
          safety_rule: playbookSafetyRule,
          stop_condition: playbookStopCondition,
          tool_hint: playbookToolHint,
        },
        score: {
          band,
          confidence,
        },
        decision_quality: decisionQuality,
        decision_contract: decisionContract,
        economics: {
          guardrail_status: guardrailStatus,
          buy_cost: buyCost,
          floor_price: floorPrice,
          recommended_price: recommendedPrice,
          currency,
        },
        route: {
          label: selectedRoute?.label ?? jsonString(route, "label"),
          provider: selectedRoute?.provider ?? null,
          source: selectedRoute?.source ?? null,
          cost_label: selectedRoute?.cost_label ?? null,
          freshness: selectedRoute?.rate_freshness_status ?? null,
          reliable: selectedRoute?.rate_reliable ?? null,
          confidence: selectedRoute?.confidence ?? jsonString(route, "confidence"),
          risk_score: selectedRoute?.risk_score ?? null,
          tradeoff: selectedRoute?.tradeoff ?? jsonString(route, "tradeoff"),
        },
        route_decision: routeDecision,
        command_ledger: commandLedger,
        blocker_count: blockerCount,
        blocking_questions: blockingQuestions,
        priority_factors: priorityFactors,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => b.rank_score - a.rank_score)
    .slice(0, limit)
    .map((item, index) => {
      const { rank_score: _rankScore, ...publicItem } = item;
      return { ...publicItem, rank: index + 1 };
    });

  const top = items[0] ?? null;
  const topAction = top?.operator_playbook.exact_ask ?? top?.operator_playbook.first_move ?? top?.decision.command ?? null;
  const topQuality = top?.decision_quality ?? null;
  const topQualityLine = topQuality && topQuality.tone !== "ready"
    ? ` Decision quality: ${topQuality.metric} - ${topQuality.detail}`
    : "";

  return {
    summary: {
      returned: items.length,
      active_snapshots: assessments.length,
      stale_snapshots: assessments.filter((assessment) => assessment.createdAt.getTime() < latestStrategyInputAt(assessment).getTime()).length,
      unassessed_open_rfqs: unassessedOpenRfqs,
      ready_to_quote: items.filter((item) => item.decision.phase === "QUOTE_CUSTOMER").length,
      needs_rates: items.filter((item) => item.decision.phase === "GET_RATES").length,
      blocked_for_maturity: items.filter((item) => item.decision.phase === "MATURE_RFQ").length,
      top_command: items[0]?.decision.command ?? null,
      operator_summary: top
        ? `${top.entity.subject}: ${top.operator_playbook.objective ?? top.decision.action_label ?? "Review pricing command"}. ${topAction ?? "Open the pricing page and refresh the strategy."}${topQualityLine}`
        : "No assessed pricing commands returned. Run or refresh strategy on open RFQs before ranking the pricing desk.",
      execution_brief: top ? {
        rank: top.rank,
        subject: top.entity.subject,
        customer: top.entity.customer,
        review_url: top.entity.review_url,
        objective: top.operator_playbook.objective,
        first_move: top.operator_playbook.first_move,
        exact_ask: top.operator_playbook.exact_ask,
        evidence_gap: top.operator_playbook.evidence_gap,
        safety_rule: top.operator_playbook.safety_rule,
        stop_condition: top.operator_playbook.stop_condition,
        tool_hint: top.operator_playbook.tool_hint,
        route_decision: top.route_decision,
        command_ledger: top.command_ledger,
        decision_quality: top.decision_quality,
        decision_contract: top.decision_contract,
      } : null,
    },
    items,
  };
}

async function ensurePortalUrlForAgent(job: { id: string; portalToken: string | null }) {
  let token = job.portalToken;
  if (!token) {
    token = createPortalToken();
    await prisma.job.update({ where: { id: job.id }, data: { portalToken: token } });
  }
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://derya-crm.vercel.app");
  return `${baseUrl}/portal/${token}`;
}

export async function dispatchTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  // Resolve job_id helper. Models often pass the human-facing reference
  // (JOB-2025-008) even when the database lookup expects the internal id.
  // Accept both, then fall back to the focused job.
  const rawJobId = typeof input.job_id === "string" ? input.job_id.trim() : "";
  let jobId = rawJobId || ctx.scopeJobId;
  if (rawJobId) {
    const resolved = await prisma.job.findFirst({
      where: {
        officeId: ctx.officeId,
        OR: [
          { id: rawJobId },
          { reference: { equals: rawJobId, mode: "insensitive" } },
        ],
      },
      select: { id: true },
    });
    if (resolved) jobId = resolved.id;
  }

  const loadCommercialStrategy = async () => {
    if (jobId) return assessJobStrategy(ctx.officeId, jobId);
    const inquiryId = typeof input.inquiry_id === "string" ? input.inquiry_id.trim() : "";
    if (inquiryId) return assessInquiryStrategy(ctx.officeId, inquiryId);
    const fallback = await prisma.job.findFirst({
      where: { officeId: ctx.officeId, status: { notIn: ["DELIVERED", "CANCELLED"] } },
      select: { id: true },
      orderBy: { updatedAt: "desc" },
    });
    return fallback ? assessJobStrategy(ctx.officeId, fallback.id) : null;
  };

  try {
    switch (name) {
      case "search_jobs": {
        const q = String(input.q ?? "");
        const limit = Math.min(50, Number(input.limit ?? 10));
        const where: any = {};
        if (input.type) where.type = String(input.type);
        if (input.status) where.status = String(input.status);
        const rows = await prisma.job.findMany({
          where: {
            officeId: ctx.officeId,
            ...where,
            OR: q ? [
              { reference: { contains: q, mode: "insensitive" } },
              { origin: { contains: q, mode: "insensitive" } },
              { destination: { contains: q, mode: "insensitive" } },
              { commodity: { contains: q, mode: "insensitive" } },
              { notes: { contains: q, mode: "insensitive" } },
              { company: { name: { contains: q, mode: "insensitive" } } },
            ] : undefined,
          },
          select: {
            id: true, reference: true, type: true, status: true,
            origin: true, destination: true, commodity: true,
            company: { select: { name: true } },
          },
          take: limit, orderBy: { updatedAt: "desc" },
        });
        return { ok: true, result: rows };
      }
      case "search_inquiries": {
        const q = String(input.q ?? "");
        const limit = Math.min(50, Number(input.limit ?? 10));
        const where: any = { officeId: ctx.officeId };
        if (input.type) where.type = String(input.type);
        const rows = await prisma.inquiry.findMany({
          where: {
            ...where,
            OR: q ? [
              { reference: { contains: q, mode: "insensitive" } },
              { subject: { contains: q, mode: "insensitive" } },
              { commodity: { contains: q, mode: "insensitive" } },
              { fromEmail: { contains: q, mode: "insensitive" } },
              { fromCompany: { contains: q, mode: "insensitive" } },
              { origin: { contains: q, mode: "insensitive" } },
              { destination: { contains: q, mode: "insensitive" } },
            ] : undefined,
          },
          select: { id: true, reference: true, subject: true, type: true, status: true, commodity: true, origin: true, destination: true, fromEmail: true, receivedAt: true },
          take: limit, orderBy: { receivedAt: "desc" },
        });
        return { ok: true, result: rows };
      }
      case "search_companies": {
        const q = String(input.q ?? "");
        const rows = await prisma.company.findMany({
          where: { officeId: ctx.officeId, name: { contains: q, mode: "insensitive" } },
          select: { id: true, name: true, status: true },
          take: Math.min(50, Number(input.limit ?? 10)),
        });
        return { ok: true, result: rows };
      }
      case "search_email_threads": {
        const q = String(input.q ?? "");
        const rows = await prisma.emailThread.findMany({
          where: {
            officeId: ctx.officeId,
            ...(input.only_unlinked ? { jobId: null, inquiryId: null } : {}),
            OR: [
              { subject: { contains: q, mode: "insensitive" } },
              { messages: { some: { OR: [
                { bodyText: { contains: q, mode: "insensitive" } },
                { fromEmail: { contains: q, mode: "insensitive" } },
                { fromName: { contains: q, mode: "insensitive" } },
              ] } } },
            ],
          },
          select: {
            id: true, subject: true, messageCount: true, lastMessageAt: true, jobId: true, inquiryId: true,
            messages: { orderBy: { sentAt: "desc" as const }, take: 1, select: { account: { select: { provider: true } } } },
          },
          take: Math.min(30, Number(input.limit ?? 10)),
          orderBy: { lastMessageAt: "desc" },
        });
        // channel lets the model adapt register (chat vs email) when drafting.
        return {
          ok: true,
          result: rows.map(({ messages, ...t }) => ({
            ...t,
            channel: messages[0]?.account?.provider === "WHATSAPP" ? "whatsapp" : "email",
          })),
        };
      }
      case "get_customer_dossier": {
        const companyId = typeof input.company_id === "string" ? input.company_id.trim() : ctx.scopeCompanyId ?? "";
        const query = typeof input.query === "string" ? input.query.trim() : "";
        if (!companyId && !query) return { ok: false, error: "Provide company_id or query." };
        return {
          ok: true,
          result: await getCustomerDossier({
            officeId: ctx.officeId,
            companyId: companyId || undefined,
            query: query || undefined,
            limit: Math.min(50, Math.max(1, Number(input.limit ?? 20))),
          }),
        };
      }
      case "search_customer_memory": {
        const companyId = typeof input.company_id === "string" ? input.company_id.trim() : ctx.scopeCompanyId ?? "";
        const query = typeof input.query === "string" ? input.query.trim() : "";
        if (!companyId) return { ok: false, error: "Provide company_id." };
        if (!query) return { ok: false, error: "Provide query." };
        return {
          ok: true,
          result: await searchCustomerMemory({
            officeId: ctx.officeId,
            companyId,
            query,
            limit: Math.min(50, Math.max(1, Number(input.limit ?? 20))),
          }),
        };
      }
      case "search_job_memory": {
        const query = typeof input.query === "string" ? input.query.trim() : "";
        if (!jobId) return { ok: false, error: "No job_id and no focused job." };
        if (!query) return { ok: false, error: "Provide query." };
        return {
          ok: true,
          result: await searchJobMemory({
            officeId: ctx.officeId,
            jobId,
            query,
            limit: Math.min(50, Math.max(1, Number(input.limit ?? 20))),
          }),
        };
      }
      case "explain_strategy_decision": {
        const inquiryId = typeof input.inquiry_id === "string" ? input.inquiry_id.trim() : "";
        if (!jobId && !inquiryId) return { ok: false, error: "Provide job_id, inquiry_id, or focus a job." };
        return {
          ok: true,
          result: await explainStrategyDecision({
            officeId: ctx.officeId,
            jobId: jobId ?? undefined,
            inquiryId: inquiryId || undefined,
          }),
        };
      }
      case "get_hardware_import_report": {
        return {
          ok: true,
          result: {
            focus:
              typeof input.focus === "string"
                ? input.focus.trim().slice(0, 120)
                : null,
            ...buildHardwareImportAgentBrief(
              getCensusPublicHardwareSnapshot()
            ),
          },
        };
      }
      case "search_market_intelligence": {
        return {
          ok: true,
          result: await searchMarketIntelligence({
            officeId: ctx.officeId,
            query: typeof input.query === "string" ? input.query.trim() : undefined,
            category: typeof input.category === "string" ? input.category.trim() : undefined,
            severity: typeof input.severity === "string" ? input.severity.trim() : undefined,
            limit: Math.min(50, Math.max(1, Number(input.limit ?? 12))),
          }),
        };
      }
      case "get_lane_intelligence": {
        const origin = typeof input.origin === "string" ? input.origin.trim() : "";
        const destination = typeof input.destination === "string" ? input.destination.trim() : "";
        if (!origin || !destination) return { ok: false, error: "Provide origin and destination." };
        return {
          ok: true,
          result: await getLaneIntelligence({
            officeId: ctx.officeId,
            origin,
            destination,
            mode: typeof input.mode === "string" ? input.mode.trim() : undefined,
            limit: Math.min(50, Math.max(1, Number(input.limit ?? 12))),
          }),
        };
      }
      case "get_customer_market_exposure": {
        const companyId = typeof input.company_id === "string" ? input.company_id.trim() : ctx.scopeCompanyId ?? "";
        const query = typeof input.query === "string" ? input.query.trim() : "";
        if (!companyId && !query) return { ok: false, error: "Provide company_id or query." };
        return {
          ok: true,
          result: await getCustomerMarketExposure({
            officeId: ctx.officeId,
            companyId: companyId || undefined,
            query: query || undefined,
            limit: Math.min(50, Math.max(1, Number(input.limit ?? 12))),
          }),
        };
      }
      case "search_market_research": {
        const query = typeof input.query === "string" ? input.query.trim() : "";
        if (!query) return { ok: false, error: "Provide query." };
        return {
          ok: true,
          result: await searchMarketResearch({
            officeId: ctx.officeId,
            query,
            limit: Math.min(50, Math.max(1, Number(input.limit ?? 12))),
          }),
        };
      }
      case "list_market_research_feed": {
        return {
          ok: true,
          result: await listMarketResearchFeed({
            officeId: ctx.officeId,
            sourceId: typeof input.source_id === "string" ? input.source_id.trim() : undefined,
            query: typeof input.query === "string" ? input.query.trim() : undefined,
            limit: Math.min(50, Math.max(1, Number(input.limit ?? 20))),
          }),
        };
      }
      case "ingest_market_source_preview": {
        const sourceId = typeof input.source_id === "string" ? input.source_id.trim() : "";
        if (!sourceId) return { ok: false, error: "Provide source_id." };
        const result = await ingestMarketSourcePreview({
          sourceId,
          query: typeof input.query === "string" ? input.query.trim() : undefined,
          url: typeof input.url === "string" ? input.url.trim() : undefined,
          limit: Math.min(20, Math.max(1, Number(input.limit ?? 10))),
        }).catch((error) => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) }));
        return result.ok ? { ok: true, result } : { ok: false, error: result.error };
      }
      case "list_market_sources": {
        return {
          ok: true,
          result: await listMarketSources({
            officeId: ctx.officeId,
            includeDisabled: input.include_disabled !== false,
          }),
        };
      }
      case "get_market_source_quality": {
        return {
          ok: true,
          result: await getMarketSourceQuality({
            officeId: ctx.officeId,
            sourceId: typeof input.source_id === "string" ? input.source_id.trim() : undefined,
          }),
        };
      }
      case "preview_market_source": {
        const sourceId = typeof input.source_id === "string" ? input.source_id.trim() : "";
        if (!sourceId) return { ok: false, error: "Provide source_id." };
        const result = await ingestMarketSourcePreview({
          sourceId,
          query: typeof input.query === "string" ? input.query.trim() : undefined,
          url: typeof input.url === "string" ? input.url.trim() : undefined,
          limit: Math.min(20, Math.max(1, Number(input.limit ?? 10))),
        }).catch((error) => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) }));
        return result.ok ? { ok: true, result } : { ok: false, error: result.error };
      }
      case "run_market_source_ingestion": {
        const sourceId = typeof input.source_id === "string" ? input.source_id.trim() : "";
        if (!sourceId) return { ok: false, error: "Provide source_id. Broad market ingestion is blocked." };
        const result = await runMarketSourceIngestion({
          officeId: ctx.officeId,
          sourceId,
          dryRun: input.dry_run === true,
          limit: Math.min(20, Math.max(1, Number(input.limit ?? 5))),
        }).catch((error) => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) }));
        return result.ok ? { ok: true, result } : { ok: false, error: "Market source ingestion failed." };
      }
      case "list_market_impacts": {
        return {
          ok: true,
          result: await listMarketImpactReviews({
            officeId: ctx.officeId,
            status: typeof input.status === "string" ? input.status.trim() : undefined,
            linkedEntityType: typeof input.linked_entity_type === "string" ? input.linked_entity_type.trim() : undefined,
            linkedEntityId: typeof input.linked_entity_id === "string" ? input.linked_entity_id.trim() : undefined,
            marketSignalId: typeof input.market_signal_id === "string" ? input.market_signal_id.trim() : undefined,
            minImpactLevel: typeof input.min_impact_level === "string" ? input.min_impact_level.trim() : undefined,
            limit: Math.min(50, Math.max(1, Number(input.limit ?? 20))),
          }),
        };
      }
      case "acknowledge_market_impact": {
        const reviewId = typeof input.review_id === "string" ? input.review_id.trim() : "";
        if (!reviewId) return { ok: false, error: "Provide review_id." };
        const result = await acknowledgeMarketImpactReview({ officeId: ctx.officeId, reviewId, userId: ctx.userId ?? null });
        return result ? { ok: true, result } : { ok: false, error: "Market impact review not found." };
      }
      case "dismiss_market_impact": {
        const reviewId = typeof input.review_id === "string" ? input.review_id.trim() : "";
        if (!reviewId) return { ok: false, error: "Provide review_id." };
        const result = await dismissMarketImpactReview({
          officeId: ctx.officeId,
          reviewId,
          userId: ctx.userId ?? null,
          feedbackKind: typeof input.feedback_kind === "string" ? input.feedback_kind.trim() : undefined,
          feedbackNote: typeof input.feedback_note === "string" ? input.feedback_note.trim() : undefined,
        });
        return result ? { ok: true, result } : { ok: false, error: "Market impact review not found." };
      }
      case "mark_market_impact_actioned": {
        const reviewId = typeof input.review_id === "string" ? input.review_id.trim() : "";
        if (!reviewId) return { ok: false, error: "Provide review_id." };
        const result = await markMarketImpactActioned({
          officeId: ctx.officeId,
          reviewId,
          userId: ctx.userId ?? null,
          feedbackNote: typeof input.feedback_note === "string" ? input.feedback_note.trim() : undefined,
        });
        return result ? { ok: true, result } : { ok: false, error: "Market impact review not found." };
      }
      case "record_market_signal_feedback": {
        const marketSignalId = typeof input.market_signal_id === "string" ? input.market_signal_id.trim() : "";
        const feedbackKind = typeof input.feedback_kind === "string" ? input.feedback_kind.trim() : "";
        if (!marketSignalId || !feedbackKind) return { ok: false, error: "Provide market_signal_id and feedback_kind." };
        const result = await recordMarketSignalFeedback({
          officeId: ctx.officeId,
          marketSignalId,
          marketImpactReviewId: typeof input.review_id === "string" ? input.review_id.trim() : undefined,
          userId: ctx.userId ?? null,
          feedbackKind,
          note: typeof input.note === "string" ? input.note.trim() : undefined,
        }).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
        return result && "error" in result ? { ok: false, error: result.error } : { ok: true, result };
      }
      case "get_job": {
        if (!jobId) return { ok: false, error: "No job_id and no focused job" };
        const job = await prisma.job.findFirst({
          where: { id: jobId, officeId: ctx.officeId },
          include: {
            company: { select: { name: true } },
            inquiry: { include: {
              carrierQuotes: true,
              emailThreads: { include: { messages: { orderBy: { sentAt: "desc" }, take: 1 } } },
            } },
            milestones: true,
            documents: true,
          },
        });
        if (!job) return { ok: false, error: "Job not found" };
        const documentReadiness = compactDocumentReadinessForAgent(job.documents);
        // Slim result for token budget
        const offers = (job.inquiry?.emailThreads ?? []).map((t) => {
          let o: any = {};
          try { if (t.supplierOffer) o = JSON.parse(t.supplierOffer); } catch {}
          return {
            thread_id: t.id,
            subject: t.subject,
            supplier: o.supplierName ?? null,
            price: o.pricePerUnit ?? null,
            currency: o.currency ?? null,
            unit: o.unit ?? null,
            qty: o.qtyAvailable ?? null,
            incoterms: o.incoterms ?? null,
            origin: o.origin ?? null,
            lead_time: o.leadTime ?? null,
            payment_terms: o.paymentTerms ?? null,
            awarded: !!t.awardedAt,
          };
        });
        return {
          ok: true,
          result: {
            id: job.id, reference: job.reference, type: job.type, status: job.status,
            customer: job.company?.name ?? null,
            origin: job.origin, destination: job.destination, mode: job.mode,
            commodity: job.commodity, weight: job.weight, volume: job.volume,
            etd: job.etd, eta: job.eta,
            revenue: job.revenue, cost: job.cost, currency: job.currency,
            inquiry_id: job.inquiryId,
            supplier_offers: job.type === "SOURCING" ? offers : undefined,
            carrier_quotes: job.type === "FORWARDING" ? job.inquiry?.carrierQuotes.map((q) => ({
              carrier: q.carrier, status: q.status, total_40hc: q.total40HC, total_40: q.total40, total_20: q.total20, transit_days: q.transitDays, service: q.service,
            })) : undefined,
            milestones: job.milestones.map((m) => ({ type: m.type, planned: m.plannedAt, actual: m.actualAt })),
            document_readiness: documentReadiness,
            documents: job.documents.map((d) => ({
              id: d.id,
              name: d.name,
              type: d.docType,
              status: d.status,
              ai_summary: d.aiSummary,
              ai_flags: d.aiFlags,
              ai_key_fields: d.aiKeyFields,
            })),
          },
        };
      }
      case "list_open_inquiries": {
        const where: any = { officeId: ctx.officeId, status: openInquiryStatusFilter() };
        if (input.type) where.type = String(input.type);
        const rows = await prisma.inquiry.findMany({
          where,
          select: { id: true, reference: true, subject: true, type: true, commodity: true, origin: true, destination: true, status: true },
          take: Math.min(50, Number(input.limit ?? 20)),
          orderBy: { receivedAt: "desc" },
        });
        return { ok: true, result: rows };
      }
      case "list_lead_board": {
        const stageInput = typeof input.stage === "string" ? input.stage.trim().toLowerCase() : "";
        const qualityInput = typeof input.quality === "string" ? input.quality.trim().toUpperCase() : "";
        const board = await loadLeadBoard(ctx.officeId, {
          market: input.market === "US" || input.market === "TR" ? input.market : undefined,
          stage: (LEAD_BOARD_STAGES as string[]).includes(stageInput) ? stageInput as LeadBoardStage : undefined,
          quality: qualityInput === "GOOD" || qualityInput === "REVIEW" || qualityInput === "WEAK" ? qualityInput : undefined,
          arrivedWithinDays: input.arrived_within_days != null ? Number(input.arrived_within_days) : undefined,
          repliedWithinDays: input.replied_within_days != null ? Number(input.replied_within_days) : undefined,
          statusScope: input.status_scope === "open" ? "open" : "all",
          q: typeof input.q === "string" ? input.q : undefined,
          limit: input.limit != null ? Number(input.limit) : undefined,
        });
        return {
          ok: true,
          result: {
            board: "Incoming RFQs lead board (/dashboard/rfq; US cards at /dashboard/rfq?view=us)",
            total_matching: board.totalMatching,
            counts: {
              by_stage: board.counts.byStage,
              by_quality: board.counts.byQuality,
            },
            leads: board.rows.map(leadBoardRowForAgent),
          },
        };
      }
      case "list_threads_awaiting_reply": {
        const cands = await prisma.emailThread.findMany({
          where: { officeId: ctx.officeId, hiddenAt: null },
          include: {
            messages: { orderBy: { sentAt: "desc" }, take: 1, include: { account: { select: { provider: true } } } },
            job: { select: { reference: true } },
            inquiry: { select: { reference: true, subject: true } },
          },
          orderBy: { lastMessageAt: "desc" },
          take: 100,
        });
        const awaiting = cands.filter((t) => t.messages[0]?.direction === "INBOUND")
          .slice(0, Math.min(20, Number(input.limit ?? 10)))
          .map((t) => ({
            thread_id: t.id, subject: t.subject,
            last_from: displayParty(t.messages[0].fromEmail, t.messages[0].fromName),
            last_at: t.messages[0].sentAt,
            channel: t.messages[0].account?.provider === "WHATSAPP" ? "whatsapp" : "email",
            linked_to: t.job?.reference ?? t.inquiry?.reference ?? t.inquiry?.subject ?? null,
          }));
        return { ok: true, result: awaiting };
      }
      case "list_stuck_jobs": {
        const stuck = await findStuckJobs(ctx.officeId, {
          daysThreshold: Number(input.days_threshold ?? 5),
          max: Math.min(20, Number(input.limit ?? 8)),
        });
        return { ok: true, result: stuck };
      }
      case "list_decision_queue": {
        const limit = Math.min(15, Math.max(1, Number(input.limit ?? 8)));
        const items = await listDecisionQueueItems(ctx.officeId, limit);
        return { ok: true, result: { summary: summarizeDecisionQueue(items), items } };
      }
      case "list_pricing_commands": {
        return {
          ok: true,
          result: await listPricingCommandsForAgent(ctx.officeId, {
            limit: input.limit,
            includeStale: input.include_stale,
          }),
        };
      }
      case "inspect_control_sheet": {
        const limit = Math.min(12, Math.max(1, Number(input.limit ?? 6)));
        const summary = getReferenceDealSummary();
        const decisions = getReferenceDealDecisions(undefined, limit);
        const operatorPlaybook = buildReferenceDealOperatorPlaybook(decisions, summary);
        return {
          ok: true,
          result: {
            source: "static pasted control-sheet snapshot",
            warning: "This is not live Google Sheets sync. It reflects the pasted rows baked into the app.",
            operator_playbook: operatorPlaybook,
            metrics: {
              total_rows: summary.totalRows,
              active_rows: summary.activeRows,
              monthly_rows: summary.monthlyRows,
              known_contract_usd: summary.knownContractUsd,
              known_profit_usd: summary.knownProfitUsd,
            },
            hygiene: summary.hygiene,
            status_counts: summary.byStatus,
            by_contact: summary.byContact.slice(0, limit),
            ranked_rows: summary.topDeals.slice(0, limit).map((deal) => ({
              id: deal.id,
              score: deal.score,
              contact: deal.contact,
              type: deal.type,
              contract: deal.contract,
              status: deal.status,
              contract_value: deal.contractValue,
              contract_currency: deal.contractCurrency,
              profit: deal.profit,
              profit_currency: deal.profitCurrency,
              origin: deal.origin,
              destination: deal.destination,
              incoterms: deal.incoterms,
              missing_fields: deal.missingFields,
              decision: referenceDealDecisionPlan(deal, deal.missingFields),
            })),
            next_actions: decisions.map((d) => ({
              deal_id: d.dealId,
              priority: d.tone,
              title: d.title,
              why: d.meta,
              action: d.nextAction,
              action_label: d.actionLabel,
              decision: d.decision,
              stop_rule: d.decision.stopRule,
              can_create_rfq: d.decision.canCreateRfq,
              missing_fields: d.missingFields,
            })),
          },
        };
      }
      case "prepare_control_sheet_rfq": {
        const dealId = typeof input.deal_id === "string" ? input.deal_id.trim() : "";
        const query = typeof input.query === "string" ? input.query.trim().toLowerCase() : "";
        const deal = dealId
          ? getReferenceDealById(dealId)
          : REFERENCE_DEALS.find((row) => {
              const haystack = `${row.contract} ${row.contact} ${row.product} ${row.origin} ${row.destination}`.toLowerCase();
              return query && haystack.includes(query);
            }) ?? null;
        if (!deal) {
          return {
            ok: false,
            error: "No matching control-sheet row found. Run inspect_control_sheet first and use an exact deal_id.",
          };
        }
        const decision = referenceDealDecisionPlan(deal);
        if (!decision.canCreateRfq) {
          return {
            ok: true,
            result: {
              not_created: true,
              blocked: true,
              warning: `${decision.stageLabel}: ${decision.stopRule}`,
              deal_id: deal.id,
              decision,
              sheet_row: {
                contact: deal.contact,
                type: deal.type,
                contract: deal.contract,
                status: deal.status,
                contract_value: deal.contractValue,
                contract_currency: deal.contractCurrency,
                profit: deal.profit,
                profit_currency: deal.profitCurrency,
              },
            },
          };
        }
        const draft = referenceDealToRfqDraft(deal);
        const qualification = qualifyRfq({
          origin: draft.origin,
          destination: draft.destination,
          mode: draft.mode,
          commodity: draft.commodity,
          containerCount: draft.containerCount,
          containerType: draft.containerType,
          dangerousGoods: "UNKNOWN",
          customsBy: "UNKNOWN",
          weight: draft.weight,
          targetPrice: null,
          targetPriceStatus: draft.targetPriceStatus,
          stackable: draft.mode === "SEA-LCL" ? "UNKNOWN" : null,
          topLoad: draft.mode === "SEA-LCL" ? "UNKNOWN" : null,
        });
        return {
          ok: true,
          result: {
            not_created: true,
            source: "static pasted control-sheet snapshot",
            warning: "This is a draft only. Use the dashboard Create RFQ action to create the inquiry; sheet contract value is not treated as target price.",
            deal_id: deal.id,
            decision,
            sheet_row: {
              contact: deal.contact,
              type: deal.type,
              contract: deal.contract,
              status: deal.status,
              contract_value: deal.contractValue,
              contract_currency: deal.contractCurrency,
              profit: deal.profit,
              profit_currency: deal.profitCurrency,
            },
            rfq_draft: draft,
            maturity: qualification,
          },
        };
      }
      case "morning_briefing": {
        const [needsReply, stuck, unawardedSourcing, openProposed, decisionQueue, memoryMorningBrief] = await Promise.all([
          prisma.emailThread.findMany({
            where: { officeId: ctx.officeId, hiddenAt: null, OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: new Date() } }] },
            include: { messages: { orderBy: { sentAt: "desc" }, take: 1 } },
            take: 100,
          }),
          findStuckJobs(ctx.officeId, { daysThreshold: 5, max: 5 }),
          prisma.inquiry.findMany({
            where: { officeId: ctx.officeId, type: "SOURCING", status: openInquiryStatusFilter() },
            include: { _count: { select: { emailThreads: true } } },
            take: 20,
          }),
          prisma.job.count({ where: { officeId: ctx.officeId, status: "PROPOSED" } }),
          listDecisionQueueItems(ctx.officeId, 8),
          generateMorningBrief({ officeId: ctx.officeId, limit: 8 }).catch(() => null),
        ]);
        const awaiting = needsReply.filter((t) => t.messages[0]?.direction === "INBOUND").length;
        const controlSheet = getReferenceDealSummary();
        const controlSheetDecisions = getReferenceDealDecisions(undefined, 4);
        const controlSheetPlaybook = buildReferenceDealOperatorPlaybook(controlSheetDecisions, controlSheet);
        return {
          ok: true,
          result: {
            proposed_jobs_awaiting_confirm: openProposed,
            threads_awaiting_reply: awaiting,
            open_sourcing_inquiries: unawardedSourcing.length,
            sourcing_with_multiple_offers: unawardedSourcing.filter((i) => i._count.emailThreads >= 2).length,
            stuck_jobs: stuck,
            memory_morning_brief: memoryMorningBrief,
            decision_queue_summary: summarizeDecisionQueue(decisionQueue),
            decision_queue: decisionQueue,
            control_sheet: {
              source: "static pasted snapshot",
              operator_playbook: controlSheetPlaybook,
              active_rows: controlSheet.activeRows,
              known_contract_usd: controlSheet.knownContractUsd,
              known_profit_usd: controlSheet.knownProfitUsd,
              hygiene: controlSheet.hygiene,
              top_rows: controlSheetDecisions.map((deal) => ({
                deal_id: deal.dealId,
                title: deal.title,
                action_label: deal.actionLabel,
                priority: deal.tone,
                score: deal.score,
                decision: deal.decision,
                stop_rule: deal.decision.stopRule,
                can_create_rfq: deal.decision.canCreateRfq,
                missing_fields: deal.missingFields,
              })),
            },
          },
        };
      }
      case "inspect_job_readiness": {
        if (!jobId) return { ok: false, error: "No job in scope" };
        const job = await loadJobForAgent(jobId, ctx.officeId);
        if (!job) return { ok: false, error: "Job not found" };
        return { ok: true, result: buildReadiness(job, input.goal as string | undefined) };
      }
      case "plan_next_actions": {
        if (!jobId) return { ok: false, error: "No job in scope" };
        const job = await loadJobForAgent(jobId, ctx.officeId);
        if (!job) return { ok: false, error: "Job not found" };
        const strategyRun = await loadCommercialStrategy();
        const readiness = buildReadiness(job, "GENERAL");
        const limit = Math.min(10, Math.max(1, Number(input.limit ?? 6)));
        const strategyCompact = strategyRun ? compactStrategyForAgent(strategyRun.strategy) : null;
        return {
          ok: true,
          result: {
            job: readiness.job,
            readiness: {
              status: readiness.status,
              score: readiness.score,
              critical_blockers: readiness.blockers.filter((b) => b.severity === "critical").length,
              warnings: readiness.blockers.filter((b) => b.severity === "warning").length,
              document_readiness: readiness.document_readiness,
            },
            commercial_decision: strategyRun ? strategyRun.strategy.operatorDecision : null,
            quote_gate: strategyRun ? strategyRun.strategy.quoteGate : null,
            decision_quality: strategyCompact?.decision_quality ?? null,
            decision_brief: strategyCompact?.decision_brief ?? null,
            execution_packet: strategyCompact?.execution_packet ?? null,
            decision_contract: strategyCompact?.decision_contract ?? null,
            command_ledger: strategyCompact?.execution_packet.commandLedger ?? null,
            strategy_summary: strategyCompact ? {
              recommendation: strategyCompact.recommendation,
              grade: strategyCompact.strategy_grade,
              guardrail: strategyCompact.price.guardrailStatus,
              confidence: strategyCompact.confidence,
            } : null,
            actions: actionsFromReadiness(readiness, limit),
            positives: readiness.wins,
          },
        };
      }
      case "inspect_brain": {
        const inputInquiryId = typeof input.inquiry_id === "string" ? input.inquiry_id.trim() : "";
        const run = await loadCommercialStrategy();
        if (!run) return { ok: false, error: "No job/RFQ found for commercial brain inspection" };
        return {
          ok: true,
          result: buildAgentBrainPacket(run, {
            jobId: jobId ?? null,
            inquiryId: inputInquiryId || null,
          }),
        };
      }
      case "assess_strategy": {
        const run = await loadCommercialStrategy();
        if (!run) return { ok: false, error: "No job/RFQ found for strategy assessment" };
        const compact = compactStrategyForAgent(run.strategy);
        return {
          ok: true,
          result: {
            assessment_id: run.assessmentId,
            created_snapshot: run.created,
            command_ledger: compact.execution_packet.commandLedger,
            ...compact,
          },
        };
      }
      case "compare_routes": {
        const run = await loadCommercialStrategy();
        if (!run) return { ok: false, error: "No job/RFQ found for route comparison" };
        const compact = compactStrategyForAgent(run.strategy);
        return {
          ok: true,
          result: {
            assessment_id: run.assessmentId,
            recommendation: run.strategy.recommendationLabel,
            selected: run.strategy.recommendedRoute,
            alternatives: run.strategy.routeOptions.slice(1),
            route_decision: compact.route_decision,
            decision_quality: compact.decision_quality,
            decision_brief: compact.decision_brief,
            quote_gate: run.strategy.quoteGate,
            operator_decision: run.strategy.operatorDecision,
            execution_packet: compact.execution_packet,
            decision_contract: compact.decision_contract,
            command_ledger: compact.execution_packet.commandLedger,
            evidence: run.strategy.evidence,
          },
        };
      }
      case "recommend_price": {
        const run = await loadCommercialStrategy();
        if (!run) return { ok: false, error: "No job/RFQ found for price recommendation" };
        const compact = compactStrategyForAgent(run.strategy);
        return {
          ok: true,
          result: {
            assessment_id: run.assessmentId,
            recommendation: run.strategy.recommendationLabel,
            action: run.strategy.action,
            price: run.strategy.price,
            quote_gate: run.strategy.quoteGate,
            operator_decision: run.strategy.operatorDecision,
            execution_packet: compact.execution_packet,
            decision_contract: compact.decision_contract,
            command_ledger: compact.execution_packet.commandLedger,
            route: run.strategy.recommendedRoute,
            confidence: run.strategy.confidence,
            evidence: run.strategy.evidence,
          },
        };
      }
      case "simulate_pricing_scenario": {
        const inputInquiryId = typeof input.inquiry_id === "string" ? input.inquiry_id.trim() : "";
        let strategyInput = jobId
          ? await loadJobStrategyInput(ctx.officeId, jobId)
          : inputInquiryId
            ? await loadInquiryStrategyInput(ctx.officeId, inputInquiryId)
            : null;
        if (!strategyInput) {
          const fallback = await prisma.job.findFirst({
            where: { officeId: ctx.officeId, status: { notIn: ["DELIVERED", "CANCELLED"] } },
            select: { id: true },
            orderBy: { updatedAt: "desc" },
          });
          if (fallback) strategyInput = await loadJobStrategyInput(ctx.officeId, fallback.id);
        }
        if (!strategyInput) return { ok: false, error: "No job/RFQ found for pricing scenario." };
        const hasAssumption =
          input.target_price !== undefined ||
          input.no_target !== undefined ||
          input.buy_cost !== undefined ||
          input.target_margin_pct !== undefined ||
          input.min_margin_pct !== undefined ||
          input.stretch_margin_pct !== undefined;
        if (!hasAssumption) {
          return {
            ok: false,
            error: "Provide at least one what-if assumption: target_price, no_target, buy_cost, target_margin_pct, min_margin_pct, or stretch_margin_pct.",
          };
        }
        const scenario = simulatePricingScenario(strategyInput, {
          targetPrice: typeof input.target_price === "number" ? input.target_price : undefined,
          targetCurrency: typeof input.target_currency === "string" ? input.target_currency : undefined,
          noTarget: input.no_target === true,
          buyCost: typeof input.buy_cost === "number" ? input.buy_cost : undefined,
          assumeLiveBuyCost: input.assume_live_buy_cost !== false,
          replaceExistingQuotes: input.replace_existing_quotes === true,
          transitDays: typeof input.transit_days === "number" ? input.transit_days : undefined,
          targetMarginPct: typeof input.target_margin_pct === "number" ? input.target_margin_pct : undefined,
          minMarginPct: typeof input.min_margin_pct === "number" ? input.min_margin_pct : undefined,
          stretchMarginPct: typeof input.stretch_margin_pct === "number" ? input.stretch_margin_pct : undefined,
        });
        return {
          ok: true,
          result: {
            entity: {
              id: strategyInput.id,
              type: strategyInput.entityType,
              subject: strategyInput.subject,
              route: `${strategyInput.origin ?? "?"} → ${strategyInput.destination ?? "?"}`,
              mode: strategyInput.mode,
            },
            ...scenario,
          },
        };
      }
      case "draft_customer_quote": {
        const inputInquiryId = typeof input.inquiry_id === "string" ? input.inquiry_id.trim() : "";
        let run: Awaited<ReturnType<typeof assessJobStrategy>> | Awaited<ReturnType<typeof assessInquiryStrategy>> | null = null;
        let context: CustomerQuoteDraftContext | null = null;
        let reviewUrl = "/dashboard/pricing";

        if (inputInquiryId) {
          const inquiry = await prisma.inquiry.findFirst({
            where: { id: inputInquiryId, officeId: ctx.officeId },
            include: {
              company: { select: { name: true } },
              carrierQuotes: { orderBy: { createdAt: "asc" } },
              job: { select: { id: true, reference: true, customerEmail: true } },
            },
          });
          if (!inquiry) return { ok: false, error: "RFQ/inquiry not found in this office." };
          run = await assessInquiryStrategy(ctx.officeId, inquiry.id);
          context = {
            reference: inquiry.job?.reference ?? inquiry.subject,
            subject: inquiry.subject,
            customerName: inquiry.company?.name ?? inquiry.fromCompany,
            customerEmail: inquiry.job?.customerEmail ?? inquiry.fromEmail,
            origin: inquiry.origin,
            destination: inquiry.destination,
            mode: inquiry.mode,
            commodity: inquiry.commodity,
            containerCount: inquiry.containerCount,
            containerType: inquiry.containerType,
            dimensions: inquiry.dimensions,
            stackable: inquiry.stackable,
            topLoad: inquiry.topLoad,
            dangerousGoods: inquiry.dangerousGoods,
            customsBy: inquiry.customsBy,
            incoterms: inquiry.incoterms,
            weight: inquiry.weight,
            volume: inquiry.volume,
            cargoReadyDate: inquiry.cargoReadyDate,
            carrierQuotes: inquiry.carrierQuotes,
          };
          reviewUrl = inquiry.job?.id ? `/dashboard/jobs/${inquiry.job.id}` : `/dashboard/rfq/${inquiry.id}`;
        } else {
          const quoteJobId = jobId || (await prisma.job.findFirst({
            where: { officeId: ctx.officeId, status: { notIn: ["DELIVERED", "CANCELLED"] } },
            select: { id: true },
            orderBy: { updatedAt: "desc" },
          }))?.id;
          if (!quoteJobId) return { ok: false, error: "No job/RFQ found for customer quote draft." };
          const job = await prisma.job.findFirst({
            where: { id: quoteJobId, officeId: ctx.officeId },
            include: {
              company: { select: { name: true } },
              inquiry: { include: { carrierQuotes: { orderBy: { createdAt: "asc" } } } },
            },
          });
          if (!job) return { ok: false, error: "Job not found in this office." };
          run = await assessJobStrategy(ctx.officeId, job.id);
          context = {
            reference: job.reference,
            subject: job.title ?? job.inquiry?.subject ?? job.reference,
            customerName: job.company?.name ?? job.inquiry?.fromCompany,
            customerEmail: job.customerEmail ?? job.inquiry?.fromEmail,
            origin: job.origin,
            destination: job.destination,
            mode: job.mode,
            commodity: job.commodity,
            containerCount: job.containerCount,
            containerType: job.containerType,
            dimensions: job.dimensions,
            stackable: job.stackable,
            topLoad: job.topLoad,
            dangerousGoods: job.dangerousGoods,
            customsBy: job.customsBy,
            incoterms: job.incoterms,
            weight: job.weight,
            volume: job.volume,
            cargoReadyDate: job.inquiry?.cargoReadyDate ?? null,
            carrierQuotes: job.inquiry?.carrierQuotes ?? [],
          };
          reviewUrl = `/dashboard/jobs/${job.id}`;
        }

        if (!run || !context) return { ok: false, error: "Strategy assessment unavailable for customer quote draft." };
        const draft = buildCustomerQuoteDraft(context, run.strategy);
        const compact = compactStrategyForAgent(run.strategy);
        return {
          ok: true,
          result: {
            assessment_id: run.assessmentId,
            not_sent: true,
            not_recorded: true,
            status: draft.status,
            blockers: draft.blockers,
            subject: draft.subject,
            body: draft.body,
            line_items_for_review: draft.lineItems,
            customer_facing_assumptions: draft.customerFacingAssumptions,
            quote_gate: run.strategy.quoteGate,
            operator_decision: run.strategy.operatorDecision,
            execution_packet: compact.execution_packet,
            decision_contract: compact.decision_contract,
            command_ledger: compact.execution_packet.commandLedger,
            internal_guardrails: draft.internalGuardrails,
            review_url: reviewUrl,
            safety: "Draft only. No customer email was sent, no Quote outcome row was created, and Job.quoteLines were not changed.",
          },
        };
      }
      case "explain_risk": {
        const run = await loadCommercialStrategy();
        if (!run) return { ok: false, error: "No job/RFQ found for risk explanation" };
        const compact = compactStrategyForAgent(run.strategy);
        return {
          ok: true,
          result: {
            assessment_id: run.assessmentId,
            strategy_grade: compact.strategy_grade,
            recommendation: run.strategy.recommendationLabel,
            quote_gate: run.strategy.quoteGate,
            operator_decision: run.strategy.operatorDecision,
            decision_quality: compact.decision_quality,
            decision_brief: compact.decision_brief,
            execution_packet: compact.execution_packet,
            decision_contract: compact.decision_contract,
            command_ledger: compact.execution_packet.commandLedger,
            top_risks: run.strategy.riskAssessments.slice(0, 8),
            mitigations: run.strategy.riskAssessments.slice(0, 8).map((r) => ({ category: r.category, mitigation: r.mitigation })),
            confidence: run.strategy.confidence,
          },
        };
      }
      case "draft_negotiation_plan": {
        const run = await loadCommercialStrategy();
        if (!run) return { ok: false, error: "No job/RFQ found for negotiation plan" };
        const s = run.strategy;
        const price = s.price;
        const route = s.recommendedRoute;
        const topRisk = s.riskAssessments[0]?.reason ?? "No dominant risk flagged.";
        const compact = compactStrategyForAgent(s);
        return {
          ok: true,
          result: {
            assessment_id: run.assessmentId,
            not_sent: true,
            stance: s.negotiation.label,
            posture: s.negotiation.posture,
            quote_gate: s.quoteGate,
            operator_decision: s.operatorDecision,
            decision_quality: compact.decision_quality,
            decision_brief: compact.decision_brief,
            execution_packet: compact.execution_packet,
            decision_contract: compact.decision_contract,
            command_ledger: compact.execution_packet.commandLedger,
            customer_talk_track: s.negotiation.customerTalkTrack,
            forwarder_counter: s.negotiation.forwarderCounter,
            internal_guardrail: s.negotiation.internalGuardrail,
            leverage: s.negotiation.leverage,
            approval_required: s.negotiation.approvalRequired,
            target_buy_limit: s.negotiation.targetBuyLimit,
            route_posture: route ? `${route.label}: ${route.tradeoff}` : "No route option is priced yet.",
            guardrail: price.guardrailStatus,
            target_posture: s.evidence.targetPosture,
            coverage_posture: s.evidence.coveragePosture,
            main_risk: topRisk,
            next_actions: s.actions,
          },
        };
      }
      case "create_forwarder_drafts": {
        const inputInquiryId = typeof input.inquiry_id === "string" ? input.inquiry_id.trim() : "";
        let inquiryId = inputInquiryId;
        let linkedJobId: string | null = null;
        if (!inquiryId && jobId) {
          const job = await prisma.job.findFirst({
            where: { id: jobId, officeId: ctx.officeId },
            select: { id: true, inquiryId: true },
          });
          inquiryId = job?.inquiryId ?? "";
          linkedJobId = job?.id ?? null;
        }
        if (!inquiryId) {
          return { ok: false, error: "No RFQ/inquiry in scope. Select a priced RFQ or pass inquiry_id before creating forwarder drafts." };
        }
        const forwarderIds = Array.isArray(input.forwarder_ids)
          ? input.forwarder_ids.map((id) => String(id).trim()).filter(Boolean)
          : [];
        const result = await createForwarderRequestDrafts({
          officeId: ctx.officeId,
          userId: ctx.userId,
          inquiryId,
          forwarderIds,
          recordBlockedNote: false,
        });
        if (result.status === "NOT_FOUND") {
          return { ok: false, error: "RFQ/inquiry not found in this office." };
        }
        const strategyRun = await assessInquiryStrategy(ctx.officeId, inquiryId).catch(() => null);
        const strategyCompact = strategyRun ? compactStrategyForAgent(strategyRun.strategy) : null;
        revalidatePath("/dashboard/pricing");
        revalidatePath(`/dashboard/rfq/${inquiryId}`);
        if (linkedJobId) revalidatePath(`/dashboard/jobs/${linkedJobId}`);
        return {
          ok: true,
          result: {
            not_sent: true,
            status: result.status,
            inquiry: result.inquiry ? {
              id: result.inquiry.id,
              subject: result.inquiry.subject,
              mode: result.inquiry.mode,
              origin: result.inquiry.origin,
              destination: result.inquiry.destination,
            } : null,
            maturity_blockers: result.missing,
            blocked_reasons: result.blockedReasons,
            eligible_forwarders: result.eligibleForwarders,
            created_drafts: result.createdDrafts,
            existing_drafts: result.existingDrafts,
            skipped_forwarders: result.skippedForwarders,
            review_url: `/dashboard/pricing?inquiry=${inquiryId}`,
            quote_gate: strategyRun?.strategy.quoteGate ?? null,
            operator_decision: strategyRun?.strategy.operatorDecision ?? null,
            execution_packet: strategyCompact?.execution_packet ?? null,
            decision_contract: strategyCompact?.decision_contract ?? null,
            command_ledger: strategyCompact?.execution_packet.commandLedger ?? null,
            safety: "Drafts were created for review only. No forwarder email was sent.",
          },
        };
      }
      case "draft_missing_info_request": {
        const inquiryId = typeof input.inquiry_id === "string" ? input.inquiry_id.trim() : "";
        const inquirySelect = {
          id: true,
          subject: true,
          fromEmail: true,
          origin: true,
          destination: true,
          mode: true,
          commodity: true,
          containerCount: true,
          containerType: true,
          dimensions: true,
          stackable: true,
          topLoad: true,
          dangerousGoods: true,
          customsBy: true,
          incoterms: true,
          weight: true,
          volume: true,
          targetPrice: true,
          targetPriceStatus: true,
          parsedData: true,
        } as const;
        const inquiry = inquiryId
          ? await prisma.inquiry.findFirst({ where: { id: inquiryId, officeId: ctx.officeId }, select: inquirySelect })
          : jobId
            ? (await prisma.job.findFirst({
                where: { id: jobId, officeId: ctx.officeId },
                select: { inquiry: { select: inquirySelect } },
              }))?.inquiry ?? null
            : await prisma.inquiry.findFirst({
                where: { officeId: ctx.officeId, status: openInquiryStatusFilter() },
                select: inquirySelect,
                orderBy: { receivedAt: "desc" },
              });
        if (!inquiry) return { ok: false, error: "No RFQ/inquiry found for missing-info draft" };

        const strategyRun = jobId
          ? await assessJobStrategy(ctx.officeId, jobId).catch(() => null)
          : await assessInquiryStrategy(ctx.officeId, inquiry.id).catch(() => null);
        const strategyCompact = strategyRun ? compactStrategyForAgent(strategyRun.strategy) : null;
        const qualification = qualifyRfq(inquiry);
        if (qualification.isMature) {
          return {
            ok: true,
            result: {
              inquiry_id: inquiry.id,
              not_sent: true,
              needed: false,
              message: "RFQ is already mature. No missing-info request is needed.",
              quote_gate: strategyRun?.strategy.quoteGate ?? null,
              operator_decision: strategyRun?.strategy.operatorDecision ?? null,
              execution_packet: strategyCompact?.execution_packet ?? null,
              decision_contract: strategyCompact?.decision_contract ?? null,
              command_ledger: strategyCompact?.execution_packet.commandLedger ?? null,
            },
          };
        }

        const draft = buildMissingInfoDraft({
          ...inquiry,
          qualification,
          blockerResolutionPlan: strategyRun?.strategy.blockerResolutionPlan,
        });
        return {
          ok: true,
          result: {
            inquiry_id: inquiry.id,
            not_sent: true,
            needed: true,
            to: draft.to,
            subject: draft.subject,
            body: draft.body,
            missing: qualification.missing,
            blocker_resolution_plan: draft.blockerResolutionPlan.map((item) => ({
              key: item.key,
              label: item.label,
              priority: item.priority,
              ask: item.ask,
              why: item.why,
            })),
            quote_gate: strategyRun?.strategy.quoteGate ?? null,
            operator_decision: strategyRun?.strategy.operatorDecision ?? null,
            execution_packet: strategyCompact?.execution_packet ?? null,
            decision_contract: strategyCompact?.decision_contract ?? null,
            command_ledger: strategyCompact?.execution_packet.commandLedger ?? null,
            target_price_needed: Boolean(qualification.targetPriceQuestion),
            known_context: draft.context,
          },
        };
      }
      case "find_follow_up_targets": {
        const scope = String(input.scope ?? (jobId ? "focused_job" : "office"));
        const thresholdHours = Math.max(1, Number(input.hours_threshold ?? 24));
        const limit = Math.min(30, Math.max(1, Number(input.limit ?? 10)));
        const where: any = {
          officeId: ctx.officeId,
          hiddenAt: null,
          OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: new Date() } }],
        };

        let scopedReference: string | null = null;
        if (scope !== "office") {
          if (!jobId) return { ok: false, error: "No job in scope" };
          const scoped = await prisma.job.findFirst({
            where: { id: jobId, officeId: ctx.officeId },
            select: { id: true, reference: true, inquiryId: true },
          });
          if (!scoped) return { ok: false, error: "Job not found" };
          scopedReference = scoped.reference;
          where.AND = [{
            OR: [
              { jobId: scoped.id },
              ...(scoped.inquiryId ? [{ inquiryId: scoped.inquiryId }] : []),
            ],
          }];
        }

        const threads = await prisma.emailThread.findMany({
          where,
          include: {
            job: { select: { reference: true } },
            inquiry: { select: { subject: true } },
            messages: { orderBy: { sentAt: "desc" }, take: 1 },
          },
          orderBy: { lastMessageAt: "desc" },
          take: 100,
        });
        const now = Date.now();
        const rows = threads
          .map((t) => {
            const latest = t.messages[0];
            if (!latest) return null;
            const ageHours = Math.floor((now - latest.sentAt.getTime()) / 3_600_000);
            if (ageHours < thresholdHours) return null;
            const waitingOnUs = latest.direction === "INBOUND";
            return {
              thread_id: t.id,
              subject: t.subject,
              age_hours: ageHours,
              latest_direction: latest.direction,
              last_from: latest.fromName ?? latest.fromEmail,
              linked_to: t.job?.reference ?? t.inquiry?.subject ?? null,
              urgency: waitingOnUs ? "operator_reply_due" : "external_follow_up_due",
              suggested_intent: waitingOnUs
                ? "Reply with the missing information or ask one precise clarifying question."
                : "Nudge for an update and restate the concrete item needed.",
              suggested_agent_prompt: waitingOnUs
                ? `Draft a reply to thread ${t.id}.`
                : `Draft a follow-up on thread ${t.id} asking for an update.`,
            };
          })
          .filter(Boolean)
          .sort((a: any, b: any) => {
            if (a.urgency !== b.urgency) return a.urgency === "operator_reply_due" ? -1 : 1;
            return b.age_hours - a.age_hours;
          })
          .slice(0, limit);

        return {
          ok: true,
          result: {
            scope: scope === "office" ? "office" : `focused job ${scopedReference ?? jobId}`,
            threshold_hours: thresholdHours,
            count: rows.length,
            followups: rows,
          },
        };
      }
      case "draft_customer_update": {
        if (!jobId) return { ok: false, error: "No job in scope" };
        const job = await loadJobForAgent(jobId, ctx.officeId);
        if (!job) return { ok: false, error: "Job not found" };

        const recipient = job.customerEmail ?? job.inquiry?.fromEmail ?? null;
        const includePortal = input.include_portal !== false;
        const portalUrl = includePortal ? await ensurePortalUrlForAgent({ id: job.id, portalToken: job.portalToken }) : null;
        const readiness = buildReadiness(job, "GENERAL");
        const route = job.origin && job.destination ? `${job.origin} to ${job.destination}` : "the shipment route";
        const customer = job.company?.name ?? "your team";
        const nextMilestone = job.milestones.find((m) => !m.actualAt);
        const nextLine = nextMilestone
          ? `Next milestone: ${nextMilestone.type}${nextMilestone.plannedAt ? ` planned for ${nextMilestone.plannedAt.toISOString().split("T")[0]}` : ""}.`
          : "All currently tracked milestones are complete.";
        const scheduleBits = [
          job.etd ? `ETD ${job.etd.toISOString().split("T")[0]}` : null,
          job.eta ? `ETA ${job.eta.toISOString().split("T")[0]}` : null,
        ].filter(Boolean);
        const issue = readiness.blockers.find((b) => b.severity === "critical" || b.area === "Documents" || b.area === "Inbox");
        const intent = typeof input.intent === "string" && input.intent.trim() ? input.intent.trim() : null;
        const subject = `Update on ${job.reference}${job.commodity ? ` - ${job.commodity}` : ""}`;
        const bodyLines = [
          `Hello,`,
          ``,
          `A quick update on ${job.reference} for ${customer}: ${route} is currently at ${job.status.replace(/_/g, " ").toLowerCase()}.`,
          scheduleBits.length ? `Schedule: ${scheduleBits.join(", ")}.` : null,
          nextLine,
          issue ? `Current item we are working through: ${issue.issue.toLowerCase()}.` : `No material blocker is flagged on our side right now.`,
          intent ? `Context for this note: ${intent}.` : null,
          portalUrl ? `Live status link: ${portalUrl}` : null,
          ``,
          `Regards,`,
          `Derya Freight OS`,
        ].filter((line): line is string => line !== null);

        return {
          ok: true,
          result: {
            recipient,
            subject,
            body: bodyLines.join("\n"),
            portal_url: portalUrl,
            not_sent: true,
            warning: recipient ? null : "No customer email found on job.customerEmail or inquiry.fromEmail.",
          },
        };
      }
      case "summarize_supplier_offers": {
        // If no job in scope, find the most recent open SOURCING job in this
        // office automatically - operator usually means "the current
        // procurement deal" without typing the JOB-ref.
        let resolvedJobId = jobId;
        if (!resolvedJobId) {
          const fallback = await prisma.job.findFirst({
            where: { officeId: ctx.officeId, type: "SOURCING", status: { notIn: ["DELIVERED", "CANCELLED"] } },
            select: { id: true },
            orderBy: { updatedAt: "desc" },
          });
          if (!fallback) return { ok: false, error: "No procurement (SOURCING) jobs in this office." };
          resolvedJobId = fallback.id;
        }
        const job = await prisma.job.findFirst({
          where: { id: resolvedJobId, officeId: ctx.officeId },
          include: {
            inquiry: {
              include: {
                emailThreads: { include: { messages: { orderBy: { sentAt: "desc" }, take: 1 } } },
              },
            },
          },
        });
        if (!job?.inquiry) return { ok: false, error: "Job has no linked inquiry" };
        if (job.type !== "SOURCING") return { ok: false, error: "Not a SOURCING job" };

        // Persistent cache: 5-minute TTL. Avoids re-extracting + re-ranking
        // 60+ supplier threads on every agent query.
        const SUMMARY_TTL_MS = 5 * 60 * 1000;
        if (job.inquiry.summaryCache && job.inquiry.summaryCacheAt &&
            Date.now() - job.inquiry.summaryCacheAt.getTime() < SUMMARY_TTL_MS) {
          try {
            return { ok: true, result: { ...JSON.parse(job.inquiry.summaryCache), _cached: true, _age_seconds: Math.round((Date.now() - job.inquiry.summaryCacheAt.getTime()) / 1000) } };
          } catch { /* fall through to recompute */ }
        }

        // Re-extract if either (a) fewer than half of threads have any
        // supplierOffer parsed, OR (b) no thread has an actual extracted
        // PRICE. The previous logic only checked (a), which made subsequent
        // calls skip after the first all-null parse - even though no prices
        // had ever been pulled.
        const withAnyParse = job.inquiry.emailThreads.filter((t) => !!t.supplierOffer);
        const withPrice = withAnyParse.filter((t) => {
          try {
            const o = JSON.parse(t.supplierOffer ?? "{}");
            return typeof o.pricePerUnit === "number" && o.pricePerUnit > 0;
          } catch { return false; }
        });
        const needsExtract =
          withAnyParse.length < job.inquiry.emailThreads.length / 2 ||
          withPrice.length === 0;
        if (needsExtract) {
          try { await extractSourcingOffersForInquiry(job.inquiry.id); } catch {}
        }
        const reread = await prisma.emailThread.findMany({
          where: { inquiryId: job.inquiry.id, officeId: ctx.officeId },
        });
        const offers = reread.map((t) => {
          let o: any = {};
          try { if (t.supplierOffer) o = JSON.parse(t.supplierOffer); } catch {}
          return {
            thread_id: t.id,
            supplier: o.supplierName ?? t.subject,
            price: o.pricePerUnit ?? null,
            currency: o.currency ?? null,
            unit: o.unit ?? null,
            qty: o.qtyAvailable ?? null,
            incoterms: o.incoterms ?? null,
            origin: o.origin ?? null,
            lead_time: o.leadTime ?? null,
            payment_terms: o.paymentTerms ?? null,
            awarded: !!t.awardedAt,
          };
        });
        offers.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
        const summary = {
          commodity: job.inquiry.commodity,
          destination: job.destination,
          offers,
          stats: {
            total: offers.length,
            with_price: offers.filter((o) => o.price != null).length,
            cheapest: offers.find((o) => o.price != null) ?? null,
          },
        };
        // Persist cache.
        await prisma.inquiry.updateMany({
          where: { id: job.inquiry.id, officeId: ctx.officeId },
          data: { summaryCache: JSON.stringify(summary), summaryCacheAt: new Date() },
        }).catch(() => {});
        return { ok: true, result: summary };
      }
      case "summarize_carrier_rates": {
        if (!jobId) return { ok: false, error: "No job in scope" };
        const job = await prisma.job.findFirst({
          where: { id: jobId, officeId: ctx.officeId },
          include: { inquiry: { include: { carrierQuotes: { orderBy: { createdAt: "asc" } } } } },
        });
        if (!job?.inquiry) return { ok: false, error: "No inquiry linked" };
        const sorted = [...job.inquiry.carrierQuotes].sort((a, b) => {
          const ap = a.total40HC ?? a.total40 ?? a.total20 ?? Infinity;
          const bp = b.total40HC ?? b.total40 ?? b.total20 ?? Infinity;
          return ap - bp;
        });
        return { ok: true, result: sorted.map((q) => ({ carrier: q.carrier, status: q.status, total_40hc: q.total40HC, total_40: q.total40, total_20: q.total20, transit_days: q.transitDays })) };
      }

      // ─── Mutations ───────────────────────────────────────────────────────
      case "merge_inquiries_into_one": {
        const result = await proposeMergeAllOpenInquiriesIntoOne({
          type: input.type === "SOURCING" || input.type === "FORWARDING" ? input.type : undefined,
          subject: typeof input.subject === "string" ? input.subject : undefined,
          commodity: typeof input.commodity === "string" ? input.commodity : undefined,
          origin: typeof input.origin === "string" ? input.origin : undefined,
          destination: typeof input.destination === "string" ? input.destination : undefined,
          weightKg: typeof input.weight_kg === "number" ? input.weight_kg : undefined,
        });
        return "error" in result ? { ok: false, error: result.error } : { ok: true, result };
      }
      case "dedup_inquiries": {
        const result = await proposeDuplicateInquiryConsolidation();
        return "error" in result ? { ok: false, error: result.error } : { ok: true, result };
      }
      case "populate_job_from_emails": {
        return { ok: false, error: "The agent no longer writes populated job fields directly from chat. Use the job page Propose from emails control or paste the source text so the proposed diff can be reviewed." };
      }
      case "award_supplier": {
        let threadId = input.thread_id as string | undefined;
        if (!threadId) {
          // Find cheapest priced thread or fuzzy-match on supplier_hint.
          if (!jobId) return { ok: false, error: "Need thread_id or focused job" };
          const inq = await prisma.job.findFirst({
            where: { id: jobId, officeId: ctx.officeId },
            select: { inquiry: { include: { emailThreads: true } } },
          });
          if (!inq?.inquiry) return { ok: false, error: "No inquiry linked" };
          const cands = inq.inquiry.emailThreads.map((t) => {
            let o: any = {};
            try { if (t.supplierOffer) o = JSON.parse(t.supplierOffer); } catch {}
            return { id: t.id, subject: t.subject, name: o.supplierName, price: o.pricePerUnit };
          });
          const hint = input.supplier_hint ? String(input.supplier_hint).toLowerCase() : "";
          let pick = hint
            ? cands.find((c) => (c.name && c.name.toLowerCase().includes(hint)) || c.subject.toLowerCase().includes(hint))
            : null;
          if (!pick) pick = cands.filter((c) => typeof c.price === "number").sort((a, b) => a.price - b.price)[0];
          if (!pick) return { ok: false, error: "No supplier matched" };
          threadId = pick.id;
        }
        const thread = await prisma.emailThread.findFirst({
          where: { id: threadId, officeId: ctx.officeId },
          select: {
            id: true,
            subject: true,
            supplierOffer: true,
            inquiry: { select: { id: true, job: { select: { id: true, reference: true } } } },
          },
        });
        if (!thread?.inquiry?.job) return { ok: false, error: "Supplier thread is not linked to a job-backed inquiry" };
        let supplierName = "selected supplier";
        let price: string | null = null;
        try {
          const offer = thread.supplierOffer ? JSON.parse(thread.supplierOffer) : {};
          if (typeof offer.supplierName === "string" && offer.supplierName.trim()) supplierName = offer.supplierName.trim();
          if (typeof offer.pricePerUnit === "number") price = `${offer.currency ?? ""} ${offer.pricePerUnit}/${offer.unit ?? "unit"}`.trim();
        } catch {}
        return createToolActionProposal({
          ctx,
          jobId: thread.inquiry.job.id,
          kind: "AGENT_TOOL_SUPPLIER_AWARD",
          action: "AWARD_SUPPLIER",
          actionInput: { threadId: thread.id },
          actionLabel: `Award ${supplierName}`,
          actionDetails: [
            `Thread: ${thread.subject}`,
            price ? `Offer: ${price}` : "",
            "Will mark the supplier as awarded, advance the procurement job, and create/reuse the child forwarding job.",
          ].filter(Boolean),
          sourcePreview: `Agent proposed supplier award for ${thread.subject}.`,
          toolName: "award_supplier",
          input,
        });
      }
      case "draft_reply": {
        let threadId = input.thread_id as string | undefined;
        if (!threadId) {
          if (!jobId) return { ok: false, error: "Need thread_id or focused job" };
          const j = await prisma.job.findFirst({
            where: { id: jobId, officeId: ctx.officeId },
            select: { inquiry: { include: { emailThreads: { orderBy: { lastMessageAt: "desc" }, take: 1, select: { id: true } } } } },
          });
          threadId = j?.inquiry?.emailThreads?.[0]?.id;
          if (!threadId) return { ok: false, error: "No threads on this job" };
        }
        const r = await draftReplyToMessage({ threadId, intent: input.intent as string | undefined });
        return { ok: true, result: r };
      }
      case "draft_counter_offer": {
        const threadId = input.thread_id as string | undefined;
        if (!threadId) return { ok: false, error: "thread_id required for counter-offer" };
        const r = await draftCounterOffer({ threadId, target: String(input.target) });
        return { ok: true, result: r };
      }
      case "extract_supplier_offers": {
        const inquiryId = input.inquiry_id as string | undefined;
        if (!inquiryId) return { ok: false, error: "inquiry_id required" };
        const r = await extractSourcingOffersForInquiry(inquiryId);
        return { ok: true, result: r };
      }
      case "edit_job": {
        if (!jobId) return { ok: false, error: "No job_id" };
        const fields = sanitizeProposalFields((input.fields as Record<string, unknown>) ?? {}, JOB_PROPOSAL_FIELDS);
        const inquiryUpdate = Object.fromEntries(
          Object.entries(fields).filter(([field]) => JOB_TO_INQUIRY_MIRROR_FIELDS.has(field))
        );
        return createToolUpdateProposal({
          ctx,
          jobId,
          kind: "AGENT_TOOL_JOB_EDIT",
          sourcePreview: `Agent proposed job field edit from tool input: ${JSON.stringify(input).slice(0, 1200)}`,
          update: fields,
          inquiryUpdate,
          toolName: "edit_job",
          input,
        });
      }
      case "edit_inquiry": {
        if (!jobId) return { ok: false, error: "No job_id (need scope to find inquiry)" };
        const inquiryUpdate = sanitizeProposalFields((input.fields as Record<string, unknown>) ?? {}, INQUIRY_PROPOSAL_FIELDS);
        return createToolUpdateProposal({
          ctx,
          jobId,
          kind: "AGENT_TOOL_RFQ_EDIT",
          sourcePreview: `Agent proposed RFQ field edit from tool input: ${JSON.stringify(input).slice(0, 1200)}`,
          inquiryUpdate,
          toolName: "edit_inquiry",
          input,
        });
      }
      case "move_job_stage": {
        if (!jobId) return { ok: false, error: "No job_id" };
        const status = String(input.status ?? "");
        if (!["PROPOSED", "INQUIRY", "QUOTED", "BOOKED", "IN_TRANSIT", "CUSTOMS", "DELIVERED", "CANCELLED"].includes(status)) {
          return { ok: false, error: "Invalid job status." };
        }
        return createToolUpdateProposal({
          ctx,
          jobId,
          kind: "AGENT_TOOL_STAGE_CHANGE",
          sourcePreview: `Agent proposed moving this job to ${status}.`,
          update: { status },
          toolName: "move_job_stage",
          input,
        });
      }
      case "add_milestone": {
        if (!jobId) return { ok: false, error: "No job_id" };
        const type = String(input.type ?? "");
        if (!["BOOKING", "CARGO_READY", "DELIVERY"].includes(type)) return { ok: false, error: "Invalid milestone type." };
        return createToolActionProposal({
          ctx,
          jobId,
          kind: "AGENT_TOOL_MILESTONE",
          action: "ADD_MILESTONE",
          actionInput: {
            type,
            plannedAt: input.planned_at,
            actualAt: input.actual_at,
            note: input.note,
          },
          actionLabel: `Add or update ${type} milestone`,
          actionDetails: [
            input.planned_at ? `Planned: ${String(input.planned_at)}` : "",
            input.actual_at ? `Actual: ${String(input.actual_at)}` : "",
            input.note ? `Note: ${String(input.note)}` : "",
          ].filter(Boolean),
          sourcePreview: `Agent proposed milestone update from tool input: ${JSON.stringify(input).slice(0, 1200)}`,
          toolName: "add_milestone",
          input,
        });
      }
      case "set_customer": {
        if (!jobId) return { ok: false, error: "No job_id" };
        const companyName = String(input.company_name ?? "").trim();
        if (!companyName) return { ok: false, error: "company_name required" };
        return createToolActionProposal({
          ctx,
          jobId,
          kind: "AGENT_TOOL_CUSTOMER_LINK",
          action: "SET_CUSTOMER",
          actionInput: {
            companyName,
            createIfMissing: input.create_if_missing !== false,
          },
          actionLabel: `Link customer ${companyName}`,
          actionDetails: [input.create_if_missing === false ? "Do not create if missing" : "Create customer if missing"],
          sourcePreview: `Agent proposed customer link from tool input: ${JSON.stringify(input).slice(0, 1200)}`,
          toolName: "set_customer",
          input,
        });
      }
      case "rename_job": {
        if (!jobId) return { ok: false, error: "No job in scope" };
        const newTitle = String(input.new_title ?? "").trim();
        if (!newTitle) return { ok: false, error: "new_title required" };
        const job = await prisma.job.findFirst({
          where: { id: jobId, officeId: ctx.officeId },
          select: { id: true, reference: true, inquiryId: true, inquiry: { select: { subject: true } } },
        });
        if (!job) return { ok: false, error: "Job not found" };
        if (!job.inquiryId) return { ok: false, error: "Job has no linked inquiry - title is stored on the inquiry's subject. Set a customer/inquiry first." };
        const oldTitle = job.inquiry?.subject ?? "(untitled)";
        return createToolUpdateProposal({
          ctx,
          jobId,
          kind: "AGENT_TOOL_JOB_RENAME",
          sourcePreview: `Agent proposed deal rename from "${oldTitle}" to "${newTitle}".`,
          inquiryUpdate: { subject: newTitle.slice(0, 200) },
          toolName: "rename_job",
          input,
        });
      }
      case "rename_company": {
        if (!jobId) return { ok: false, error: "No job_id" };
        const newName = String(input.new_name ?? "").trim();
        if (!newName) return { ok: false, error: "new_name required" };
        return createToolActionProposal({
          ctx,
          jobId,
          kind: "AGENT_TOOL_COMPANY_RENAME",
          action: "RENAME_COMPANY",
          actionInput: { newName },
          actionLabel: `Rename linked customer to ${newName}`,
          actionDetails: ["Affects every job linked to this customer."],
          sourcePreview: `Agent proposed customer rename from tool input: ${JSON.stringify(input).slice(0, 1200)}`,
          toolName: "rename_company",
          input,
        });
      }
      case "set_revenue": {
        if (!jobId) return { ok: false, error: "No job_id" };
        const amount = Number(input.amount);
        if (!Number.isFinite(amount)) return { ok: false, error: "amount must be a number" };
        const update: Record<string, unknown> = { revenue: amount };
        if (typeof input.currency === "string" && ["USD", "EUR", "GBP", "TRY"].includes(input.currency)) update.currency = input.currency;
        return createToolUpdateProposal({
          ctx,
          jobId,
          kind: "AGENT_TOOL_REVENUE",
          sourcePreview: `Agent proposed customer revenue ${input.currency ?? ""} ${amount}.`,
          update,
          toolName: "set_revenue",
          input,
        });
      }
      case "set_cost": {
        if (!jobId) return { ok: false, error: "No job_id" };
        const amount = Number(input.amount);
        if (!Number.isFinite(amount)) return { ok: false, error: "amount must be a number" };
        const update: Record<string, unknown> = { cost: amount };
        if (typeof input.currency === "string" && ["USD", "EUR", "GBP", "TRY"].includes(input.currency)) update.currency = input.currency;
        return createToolUpdateProposal({
          ctx,
          jobId,
          kind: "AGENT_TOOL_COST",
          sourcePreview: `Agent proposed buy cost ${input.currency ?? ""} ${amount}.`,
          update,
          toolName: "set_cost",
          input,
        });
      }
      case "add_quote_line": {
        if (!jobId) return { ok: false, error: "No job_id" };
        const job = await prisma.job.findFirst({
          where: { id: jobId, officeId: ctx.officeId },
          select: { id: true, notes: true, quoteLines: true, currency: true },
        });
        if (!job) return { ok: false, error: "Job not found" };
        const description = String(input.description ?? "").trim().slice(0, 300);
        const amount = Number(input.amount);
        if (!description || !Number.isFinite(amount)) return { ok: false, error: "description and numeric amount are required" };
        const currency = typeof input.currency === "string" ? input.currency : job.currency ?? "USD";
        const legacy = job.quoteLines == null
          ? parsePipeLines(job.notes).map((line) => `${line.desc}|${line.amount}|${line.cur}`)
          : [];
        const existing = [job.quoteLines ?? "", ...legacy].filter(Boolean).join("\n");
        const line = `${description}|${amount}|${currency}`;
        return createToolUpdateProposal({
          ctx,
          jobId,
          kind: "AGENT_TOOL_QUOTE_LINE",
          sourcePreview: `Agent proposed quote line: ${description} · ${currency} ${amount}.`,
          update: { quoteLines: existing ? `${existing}\n${line}` : line },
          toolName: "add_quote_line",
          input,
        });
      }
      case "hide_unrelated_threads": {
        const requestedLimit = Number(input.limit ?? 25);
        const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 25;
        const threads = await prisma.emailThread.findMany({
          where: {
            officeId: ctx.officeId,
            hiddenAt: null,
            jobId: null,
            inquiryId: null,
            messages: { some: { direction: "INBOUND", classification: "OTHER" } },
          },
          select: { id: true },
          orderBy: { lastMessageAt: "desc" },
          take: limit,
        });
        if (threads.length === 0) return { ok: false, error: "No unlinked OTHER-classified threads found to propose hiding." };
        const result = await createPendingBulkHideThreadsProposal({
          officeId: ctx.officeId,
          userId: ctx.userId,
          threadIds: threads.map((thread) => thread.id),
          kind: "AGENT_HIDE_UNRELATED_THREADS",
          reason: "Agent selected unlinked threads classified as OTHER.",
          sourceType: "AGENT_TOOL",
          sourcePreview: `Agent proposed hiding ${threads.length} unlinked OTHER-classified inbox thread${threads.length === 1 ? "" : "s"}.`,
          toolTrace: proposalToolTrace("hide_unrelated_threads", input),
        });
        return result.ok ? { ok: true, result } : { ok: false, error: result.error };
      }
      case "link_threads_to_job": {
        if (!jobId) return { ok: false, error: "No job in scope" };
        const job = await prisma.job.findFirst({
          where: { id: jobId, officeId: ctx.officeId },
          select: {
            id: true, type: true, inquiryId: true, reference: true,
            commodity: true, origin: true, destination: true,
            company: { select: { name: true } },
            inquiry: { select: { fromEmail: true, fromCompany: true } },
          },
        });
        if (!job?.inquiryId) return { ok: false, error: "Focused job has no linked inquiry" };

        // Build search terms. Operator override beats auto-derivation.
        const explicitQ = (input.q as string | undefined)?.trim();
        const terms: string[] = [];
        if (explicitQ) {
          terms.push(explicitQ);
        } else {
          // Derive from job context: commodity (split into per-word too), route, customer.
          if (job.commodity) {
            terms.push(job.commodity);
            // Also search per significant word so "soybean meal" matches "soybean", "SBM", etc.
            for (const w of job.commodity.split(/\s+/)) {
              if (w.length >= 4 && !terms.includes(w)) terms.push(w);
            }
          }
          if (job.destination) terms.push(job.destination);
          if (job.origin) terms.push(job.origin);
          if (job.company?.name) terms.push(job.company.name);
          if (job.inquiry?.fromEmail) {
            const domain = job.inquiry.fromEmail.split("@")[1];
            if (domain) terms.push(domain);
          }
          if (job.inquiry?.fromCompany) terms.push(job.inquiry.fromCompany);
        }
        if (terms.length === 0) return { ok: false, error: "No commodity/route/customer set on this job - pass q explicitly or run populate_job_from_emails first." };

        const onlyUnlinked = input.only_unlinked !== false;
        const limit = Math.min(100, Number(input.limit ?? 50));

        // Build a big OR query across all terms × all fields.
        const orClauses: any[] = [];
        for (const term of terms) {
          orClauses.push({ subject: { contains: term, mode: "insensitive" } });
          orClauses.push({ messages: { some: { OR: [
            { bodyText: { contains: term, mode: "insensitive" } },
            { fromEmail: { contains: term, mode: "insensitive" } },
            { fromName: { contains: term, mode: "insensitive" } },
          ] } } });
        }
        const where: any = { officeId: ctx.officeId, OR: orClauses };
        if (onlyUnlinked) {
          // Only consider threads not already on a different inquiry/job.
          where.jobId = null;
          where.AND = [{ OR: [{ inquiryId: null }, { inquiryId: job.inquiryId }] }];
        }

        const threads = await prisma.emailThread.findMany({
          where: { ...where, officeId: ctx.officeId },
          take: limit,
          select: { id: true, subject: true, inquiryId: true },
        });
        const toLink = threads.filter((t) => t.inquiryId !== job.inquiryId);
        if (toLink.length === 0) {
          return { ok: true, result: {
            linked: 0,
            already_linked: threads.length,
            search_terms: terms,
            message: threads.length > 0
              ? `Already linked ${threads.length} matching thread(s) to this job. Nothing new to attach.`
              : `No matching threads found across [${terms.join(", ")}]`,
          } };
        }
        return createToolActionProposal({
          ctx,
          jobId,
          kind: "AGENT_TOOL_THREAD_LINK",
          action: "LINK_THREADS_TO_JOB",
          actionInput: {
            threadIds: toLink.map((thread) => thread.id),
            inquiryId: job.inquiryId,
          },
          actionLabel: `Link ${toLink.length} email thread${toLink.length === 1 ? "" : "s"} to ${job.reference}`,
          actionDetails: [
            `Search terms: ${terms.join(", ")}`,
            ...toLink.slice(0, 5).map((thread) => `Thread: ${thread.subject}`),
            toLink.length > 5 ? `And ${toLink.length - 5} more thread${toLink.length - 5 === 1 ? "" : "s"}` : "",
          ].filter(Boolean),
          sourcePreview: `Agent proposed linking ${toLink.length} thread(s) to ${job.reference}: ${toLink.map((thread) => thread.subject).join("; ").slice(0, 1200)}`,
          toolName: "link_threads_to_job",
          input: { ...input, derived_terms: terms },
        });
      }
      case "seed_demo_load": {
        return {
          ok: false,
          error: "Legacy demo seed is disabled. Use `npm run demo:video-loads -- --apply` from the repo to reset the two Inbox video demo loads.",
        };
      }
      case "ask_about_document": {
        const documentId = String(input.document_id ?? "");
        const question = String(input.question ?? "");
        if (!documentId || !question) return { ok: false, error: "document_id and question required" };
        const r = await askAboutDocument({ documentId, question });
        return "error" in r ? { ok: false, error: r.error } : { ok: true, result: r };
      }
      case "analyze_document": {
        const documentId = String(input.document_id ?? "");
        if (!documentId) return { ok: false, error: "document_id required" };
        const r = await analyzeJobDocument({ documentId, force: input.force === true });
        return "error" in r ? { ok: false, error: r.error } : { ok: true, result: r };
      }
      case "delete_job": {
        if (!jobId) return { ok: false, error: "No job_id" };
        return { ok: false, error: "The agent no longer deletes jobs directly. Delete from the job page so a human is clearly operating the destructive control." };
      }
      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
