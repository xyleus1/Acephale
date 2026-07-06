"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { requireSession } from "./auth";
import { openInquiryStatusFilter } from "./inquiry-status";
import { createPendingBulkActionProposal } from "./agent-proposals";

type MergeArgs = {
  type?: "SOURCING" | "FORWARDING";
  subject?: string;
  commodity?: string;
  origin?: string;
  destination?: string;
  weightKg?: number;
};

function inquiryReviewItem(inquiry: {
  id: string;
  subject: string;
  type: string;
  fromEmail: string | null;
  fromCompany: string | null;
  commodity: string | null;
  origin: string | null;
  destination: string | null;
  mode: string | null;
  createdAt: Date;
  _count?: { emailThreads: number };
}, role?: string) {
  return {
    id: inquiry.id,
    title: inquiry.subject,
    meta: [
      role,
      inquiry.type,
      inquiry.fromCompany ?? inquiry.fromEmail ?? "unknown sender",
      inquiry.mode ?? null,
      `${inquiry._count?.emailThreads ?? 0} thread${(inquiry._count?.emailThreads ?? 0) === 1 ? "" : "s"}`,
    ].filter(Boolean).join(" · "),
    detail: [
      inquiry.commodity ? `Commodity: ${inquiry.commodity}` : null,
      inquiry.origin || inquiry.destination ? `Route: ${inquiry.origin ?? "?"} → ${inquiry.destination ?? "?"}` : null,
    ].filter(Boolean).join(" · ") || null,
    createdAt: inquiry.createdAt.toISOString(),
  };
}

type InquiryReviewItem = ReturnType<typeof inquiryReviewItem>;

async function openMergeCandidates(officeId: string, type?: "SOURCING" | "FORWARDING") {
  return prisma.inquiry.findMany({
    where: {
      officeId,
      status: openInquiryStatusFilter(),
      ...(type ? { type } : {}),
      OR: [
        { job: null },
        { job: { is: { status: "PROPOSED" } } },
      ],
    },
    include: {
      _count: { select: { emailThreads: true } },
      job: { select: { id: true, status: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function proposeDuplicateInquiryConsolidation(): Promise<
  | { ok: true; proposalId: string; clusters: number; duplicates: number; message: string }
  | { error: string }
> {
  const session = await requireSession();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: "ANTHROPIC_API_KEY is not set" };

  const inquiries = await prisma.inquiry.findMany({
    where: {
      officeId: session.officeId,
      status: openInquiryStatusFilter(),
    },
    select: {
      id: true, subject: true, type: true, fromEmail: true, fromCompany: true,
      commodity: true, origin: true, destination: true, mode: true, notes: true,
      receivedAt: true, createdAt: true,
      job: { select: { id: true, status: true } },
      _count: { select: { emailThreads: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (inquiries.length < 2) return { error: "Need at least 2 open inquiries to review duplicates." };

  const lines = inquiries.map((i, idx) => {
    const summary = i.notes ? ` | summary=${i.notes.replace(/\s+/g, " ").trim().slice(0, 240)}` : "";
    return `[${idx}] id=${i.id} | ${i.type} | "${i.subject}" | from=${i.fromEmail ?? i.fromCompany ?? "?"} | commodity=${i.commodity ?? "—"} | route=${i.origin ?? "?"}→${i.destination ?? "?"} | mode=${i.mode ?? "—"} | created=${i.createdAt.toISOString().split("T")[0]}${summary}`;
  }).join("\n");

  const client = new Anthropic({ apiKey });
  const result = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1200,
    system: `You consolidate duplicate freight inquiries.

Input: a numbered list of open inquiries in one office. Many are duplicates of the same underlying deal.

Output ONLY this JSON (no markdown):
{ "clusters": [
    { "ids": ["<inquiry-id>", "<inquiry-id>", ...], "reason": "<short reason>" }
] }

Rules:
- Cluster only inquiries that represent the same underlying deal.
- Strong signals: same commodity, customer/sender, route, subject stem, or summary references.
- Include only clusters of size >= 2.
- If unsure, leave the inquiry out. This is a human-reviewed proposal, not a dumping ground.`,
    messages: [{ role: "user", content: `OPEN INQUIRIES:\n\n${lines}` }],
  });

  const text = result.content[0].type === "text" ? result.content[0].text : "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { error: "AI returned no JSON" };
  let parsed: { clusters?: { ids: string[]; reason: string }[] };
  try { parsed = JSON.parse(m[0]); } catch { return { error: "AI JSON parse failed" }; }

  const validIds = new Set(inquiries.map((inquiry) => inquiry.id));
  const inquiryById = new Map(inquiries.map((inquiry) => [inquiry.id, inquiry]));
  const clusters: {
    keeperInquiryId: string;
    loserInquiryIds: string[];
    reason: string;
    keeper: InquiryReviewItem;
    losers: InquiryReviewItem[];
  }[] = [];
  for (const cluster of parsed.clusters ?? []) {
    const ids = (cluster.ids ?? []).filter((id) => validIds.has(id));
    if (ids.length < 2) continue;
    const sorted = ids
      .map((id) => inquiryById.get(id))
      .filter((inquiry): inquiry is (typeof inquiries)[number] => Boolean(inquiry))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    if (sorted.length < 2) continue;
    const hasConfirmedJob = sorted.some((inquiry) => inquiry.job && inquiry.job.status !== "PROPOSED");
    if (hasConfirmedJob) continue;
    const keeper = sorted[0];
    if (!keeper) continue;
    const losers = sorted.slice(1);
    if (losers.length === 0) continue;
    clusters.push({
      keeperInquiryId: keeper.id,
      loserInquiryIds: losers.map((loser) => loser.id),
      reason: cluster.reason ?? "AI-detected duplicate",
      keeper: inquiryReviewItem(keeper, "keep"),
      losers: losers.map((loser) => inquiryReviewItem(loser, "merge/remove")),
    });
  }

  if (clusters.length === 0) return { error: "No safe duplicate clusters found." };
  const duplicates = clusters.reduce((sum, cluster) => sum + cluster.loserInquiryIds.length, 0);
  const reviewItems = clusters.map((cluster, index) => ({
    id: `cluster-${index + 1}`,
    title: `Cluster ${index + 1}: ${cluster.reason}`,
    meta: `Keep ${String(cluster.keeper.title)} · merge ${cluster.loserInquiryIds.length}`,
    detail: [
      `Keeper: ${String(cluster.keeper.title)}`,
      `Remove: ${cluster.losers.map((loser) => String(loser.title)).join("; ")}`,
    ].join(" | "),
  }));

  const proposal = await createPendingBulkActionProposal({
    officeId: session.officeId,
    userId: session.userId,
    kind: "BULK_DEDUP_INQUIRIES",
    action: "DEDUP_INQUIRIES",
    actionInput: { clusters },
    actionLabel: `Merge ${duplicates} duplicate inquir${duplicates === 1 ? "y" : "ies"} across ${clusters.length} cluster${clusters.length === 1 ? "" : "s"}`,
    actionDetails: [
      "Keeps the oldest safe inquiry in each cluster.",
      "Moves email threads from duplicates to the keeper.",
      "Deletes only duplicate inquiries whose linked jobs are still PROPOSED.",
    ],
    reviewItems,
    sourceType: "AI_DUPLICATE_SCAN",
    sourcePreview: `AI duplicate scan over ${inquiries.length} open inquiries proposed ${clusters.length} reviewed cluster${clusters.length === 1 ? "" : "s"}.`,
    toolTrace: { parser: "claude-haiku-4-5-20251001", rawParsed: parsed },
  });
  if (!proposal.ok) return { error: proposal.error };
  return { ok: true, proposalId: proposal.proposalId, clusters: clusters.length, duplicates, message: proposal.message };
}

export async function proposeMergeAllOpenInquiriesIntoOne(args: MergeArgs = {}): Promise<
  | { ok: true; proposalId: string; mergeCount: number; subject: string; message: string }
  | { error: string }
> {
  const session = await requireSession();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: "ANTHROPIC_API_KEY is not set" };

  const candidates = await openMergeCandidates(session.officeId, args.type);
  if (candidates.length < 2) return { error: "Need at least 2 mergeable inquiries — none or only one open." };
  candidates.sort((a, b) => {
    if (b._count.emailThreads !== a._count.emailThreads) return b._count.emailThreads - a._count.emailThreads;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  const keeper = candidates[0];
  const losers = candidates.slice(1);

  const summaryInput = candidates.map((c) =>
    `- "${c.subject}" | commodity: ${c.commodity ?? "—"} | from: ${c.fromEmail ?? c.fromCompany ?? "—"} | route: ${c.origin ?? "?"} → ${c.destination ?? "?"}`
  ).join("\n");

  const client = new Anthropic({ apiKey });
  const result = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 250,
    system: `You write a single concise subject line for a consolidated procurement/forwarding job that merges multiple related RFQs.

Output ONLY this JSON (no markdown):
{ "subject": string, "commodity": string }`,
    messages: [{ role: "user", content: `Consolidating these ${candidates.length} inquiries into one ${args.type ?? "open"} job:\n\n${summaryInput}` }],
  });
  const txt = result.content[0].type === "text" ? result.content[0].text : "";
  const m = txt.match(/\{[\s\S]*\}/);
  let newSubject = keeper.subject;
  let newCommodity = keeper.commodity;
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      if (typeof j.subject === "string" && j.subject.trim()) newSubject = j.subject.trim().slice(0, 200);
      if (typeof j.commodity === "string" && j.commodity.trim()) newCommodity = j.commodity.trim().slice(0, 200);
    } catch { /* keep keeper fields */ }
  }

  const finalSubject = args.subject?.trim() || newSubject;
  const finalCommodity = args.commodity?.trim() || newCommodity || "";
  const finalOrigin = args.origin?.trim() || null;
  const finalDestination = args.destination?.trim() || null;
  const finalWeight = typeof args.weightKg === "number" && Number.isFinite(args.weightKg) ? args.weightKg : null;

  const reviewItems = [
    inquiryReviewItem(keeper, "keep"),
    ...losers.map((loser) => inquiryReviewItem(loser, "merge/remove")),
  ];

  const proposal = await createPendingBulkActionProposal({
    officeId: session.officeId,
    userId: session.userId,
    kind: "BULK_MERGE_INQUIRIES_INTO_ONE",
    action: "MERGE_INQUIRIES_INTO_ONE",
    actionInput: {
      keeperInquiryId: keeper.id,
      loserInquiryIds: losers.map((loser) => loser.id),
      subject: finalSubject,
      commodity: finalCommodity,
      origin: finalOrigin,
      destination: finalDestination,
      weightKg: finalWeight,
    },
    actionLabel: `Consolidate ${losers.length + 1} open inquir${losers.length + 1 === 1 ? "y" : "ies"} into one deal`,
    actionDetails: [
      `Keeper: ${keeper.subject}`,
      `New subject: ${finalSubject}`,
      finalCommodity ? `Commodity: ${finalCommodity}` : "",
      finalOrigin || finalDestination ? `Route: ${finalOrigin ?? "?"} → ${finalDestination ?? "?"}` : "",
      finalWeight != null ? `Weight: ${finalWeight.toLocaleString()} kg` : "",
    ].filter(Boolean),
    reviewItems,
    sourceType: "AGENT_MERGE_PROPOSAL",
    sourcePreview: `Proposal to consolidate ${candidates.length} ${args.type ?? "open"} inquiries into "${finalSubject}".`,
    toolTrace: { parser: "claude-haiku-4-5-20251001", generatedSubject: newSubject, generatedCommodity: newCommodity },
  });
  if (!proposal.ok) return { error: proposal.error };
  return { ok: true, proposalId: proposal.proposalId, mergeCount: losers.length, subject: finalSubject, message: proposal.message };
}

// AI-driven consolidation of duplicate Inquiries (and their PROPOSED jobs).
// Used when the inbox has many separate threads that all describe the same
// underlying deal — typical for SOURCING (one buyer, many supplier replies)
// where each supplier's first email creates its own thread and the AI hadn't
// linked them yet at the time.
//
// Strategy: load all open inquiries for the office, hand the list to Haiku,
// ask it to cluster them into "this is one deal" groups. For each cluster of
// 2+, keep the oldest inquiry, move all email threads from the others onto
// the keeper, and delete the duplicates (plus their PROPOSED jobs). Confirmed
// jobs (status != PROPOSED) are NEVER auto-merged.
export async function consolidateDuplicateInquiries(): Promise<
  | { ok: true; clusters: number; merged: number }
  | { error: string }
> {
  const session = await requireSession();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: "ANTHROPIC_API_KEY is not set" };

  const inquiries = await prisma.inquiry.findMany({
    where: {
      officeId: session.officeId,
      status: openInquiryStatusFilter(),
    },
    select: {
      id: true, subject: true, type: true, fromEmail: true, fromCompany: true,
      commodity: true, origin: true, destination: true, mode: true, notes: true,
      receivedAt: true, createdAt: true,
      job: { select: { id: true, status: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (inquiries.length < 2) return { ok: true, clusters: 0, merged: 0 };

  // Build candidate list for the AI.
  const lines = inquiries.map((i, idx) => {
    const summary = i.notes ? ` | summary=${i.notes.replace(/\s+/g, " ").trim().slice(0, 240)}` : "";
    return `[${idx}] id=${i.id} | ${i.type} | "${i.subject}" | from=${i.fromEmail ?? i.fromCompany ?? "?"} | commodity=${i.commodity ?? "—"} | route=${i.origin ?? "?"}→${i.destination ?? "?"} | mode=${i.mode ?? "—"} | created=${i.createdAt.toISOString().split("T")[0]}${summary}`;
  }).join("\n");

  const client = new Anthropic({ apiKey });
  const result = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1200,
    system: `You consolidate duplicate freight inquiries.

Input: a numbered list of open inquiries in one office. Many are duplicates of the same underlying deal (especially SOURCING — multiple supplier conversations for one buyer-commodity).

Output ONLY this JSON (no markdown):
{ "clusters": [
    { "ids": ["<inquiry-id>", "<inquiry-id>", ...], "reason": "<short — why these are one deal>" }
] }

Rules:
- Cluster TOGETHER inquiries that represent the SAME underlying deal. Strong signals: same commodity (loose match — "soybean" / "soybean meal" / "SBM" all match), same buyer/customer, overlapping origin or destination, similar subjects (Re:/Fwd: chains, common stem like "Animal Feed Grade Soybean Meal"), or a "summary" field that mentions the other inquiry's commodity/route/buyer (umbrella deals like "multi-destination procurement" whose summary names specific countries should absorb single-country threads).
- Use the type as a tiebreaker: SOURCING duplicates are very common; FORWARDING duplicates are rarer.
- Only include clusters of size >= 2. Singletons go nowhere.
- Be aggressive about merging — duplicates are a bigger pain than over-merging. The operator can split later.
- If nothing clusters, return { "clusters": [] }.`,
    messages: [{
      role: "user",
      content: `OPEN INQUIRIES:\n\n${lines}`,
    }],
  });

  const text = result.content[0].type === "text" ? result.content[0].text : "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { error: "AI returned no JSON" };
  let parsed: { clusters?: { ids: string[]; reason: string }[] };
  try { parsed = JSON.parse(m[0]); } catch { return { error: "AI JSON parse failed" }; }
  const clusters = parsed.clusters ?? [];

  let mergedCount = 0;
  let clusterCount = 0;
  const validIds = new Set(inquiries.map((i) => i.id));
  const inquiryById = new Map(inquiries.map((i) => [i.id, i]));

  for (const cluster of clusters) {
    const ids = (cluster.ids ?? []).filter((id) => validIds.has(id));
    if (ids.length < 2) continue;

    // Keeper = oldest by createdAt. Skip merging if any non-PROPOSED job is
    // attached to ANY inquiry in the cluster — those are confirmed and we
    // should not silently lose data. Merge only into the keeper if it's safe.
    const sorted = ids
      .map((id) => inquiryById.get(id)!)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const keeper = sorted[0];
    const losers = sorted.slice(1);

    const hasConfirmedJob = sorted.some((i) => i.job && i.job.status !== "PROPOSED");
    if (hasConfirmedJob) continue;

    clusterCount++;

    for (const loser of losers) {
      // Move email threads off the loser onto the keeper.
      await prisma.emailThread.updateMany({
        where: { inquiryId: loser.id, officeId: session.officeId },
        data: { inquiryId: keeper.id },
      });
      // Delete the loser's PROPOSED job (cascade is fine since job has only
      // soft refs — JobMilestone/JobDocument cascade delete via schema).
      if (loser.job?.id) {
        await prisma.job.deleteMany({ where: { id: loser.job.id, officeId: session.officeId } }).catch(() => {});
      }
      // Delete the loser inquiry itself. Anything that referenced it
      // (email threads moved above; carrier quotes — drop them since this is
      // an unconfirmed dup).
      await prisma.carrierQuote.deleteMany({ where: { inquiryId: loser.id, inquiry: { officeId: session.officeId } } }).catch(() => {});
      await prisma.inquiry.deleteMany({ where: { id: loser.id, officeId: session.officeId } }).catch(() => {});
      mergedCount++;
    }

    // Append a merge note to the keeper for traceability.
    const noteAppend = `\n\n[Auto-merged ${losers.length} duplicate inquir${losers.length === 1 ? "y" : "ies"} on ${new Date().toISOString().split("T")[0]}: ${cluster.reason ?? "AI-detected duplicate"}]`;
    await prisma.$executeRaw`UPDATE "Inquiry" SET "notes" = COALESCE("notes", '') || ${noteAppend} WHERE "id" = ${keeper.id}`;
  }

  revalidatePath("/dashboard/rfq");
  revalidatePath("/dashboard/inbox");
  revalidatePath("/dashboard/jobs");
  return { ok: true, clusters: clusterCount, merged: mergedCount };
}

// Operator-directed: consolidate ALL open inquiries (optionally filtered by
// type) into ONE big procurement/forwarding job. Used when the user has a
// bunch of related-but-not-identical RFQs (soybean meal, corn gluten,
// cottonseed cake, fish meal — all animal feed sourcing for one buyer) and
// wants to manage them as a single job rather than N separate ones.
//
// Strategy: keep the inquiry with the most attached email threads (richest
// context), move every other inquiry's threads onto it, regenerate the
// subject + commodity using AI, delete sibling inquiries + their PROPOSED
// jobs. CONFIRMED jobs are NEVER auto-merged.
export async function mergeAllOpenInquiriesIntoOne(args: {
  type?: "SOURCING" | "FORWARDING";
  // Operator overrides for the keeper. When set, these win over the AI-
  // generated subject/commodity and pre-fill missing route/weight fields.
  subject?: string;
  commodity?: string;
  origin?: string;
  destination?: string;
  weightKg?: number;
} = {}): Promise<
  | { ok: true; mergedCount: number; keeperInquiryId: string; keeperJobId: string | null; subject: string }
  | { error: string }
> {
  const session = await requireSession();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: "ANTHROPIC_API_KEY is not set" };

  const where: {
    officeId: string;
    status: { notIn: string[] };
    type?: string;
    job: { is: { status: string } } | null;
  } = {
    officeId: session.officeId,
    status: openInquiryStatusFilter(),
    // Only consider inquiries whose linked job is still PROPOSED (or has no
    // job yet). Confirmed jobs are real work and shouldn't be merged.
    job: null,
  };
  if (args.type) where.type = args.type;

  // Find all candidates (job is null OR job.status = PROPOSED).
  const candidates = await prisma.inquiry.findMany({
    where: {
      officeId: session.officeId,
      status: openInquiryStatusFilter(),
      ...(args.type ? { type: args.type } : {}),
      OR: [
        { job: null },
        { job: { is: { status: "PROPOSED" } } },
      ],
    },
    include: {
      _count: { select: { emailThreads: true } },
      job: { select: { id: true, status: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (candidates.length < 2) return { error: "Need at least 2 mergeable inquiries — none or only one open." };

  // Keeper = the one with the most attached email threads (richest context).
  // Tiebreak by oldest.
  candidates.sort((a, b) => {
    if (b._count.emailThreads !== a._count.emailThreads) return b._count.emailThreads - a._count.emailThreads;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  const keeper = candidates[0];
  const losers = candidates.slice(1);

  // AI generates a new subject + commodity that summarizes the consolidated deal.
  const summaryInput = candidates.map((c) =>
    `- "${c.subject}" | commodity: ${c.commodity ?? "—"} | from: ${c.fromEmail ?? c.fromCompany ?? "—"} | route: ${c.origin ?? "?"} → ${c.destination ?? "?"}`
  ).join("\n");

  const client = new Anthropic({ apiKey });
  const result = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 250,
    system: `You write a single concise subject line for a consolidated procurement/forwarding job that merges multiple related RFQs.

Output ONLY this JSON (no markdown):
{ "subject": string, "commodity": string }

The subject should be short (under 80 chars) and describe the umbrella deal — e.g. "Animal feed procurement (soybean meal, corn gluten, cottonseed cake, fish meal)" or "Multi-port European delivery — Q3 2026".
The commodity field should be a comma-separated list of the underlying commodities or a generic category if they all fit one.`,
    messages: [{
      role: "user",
      content: `Consolidating these ${candidates.length} inquiries into one ${args.type ?? "open"} job:\n\n${summaryInput}`,
    }],
  });
  const txt = result.content[0].type === "text" ? result.content[0].text : "";
  const m = txt.match(/\{[\s\S]*\}/);
  let newSubject = keeper.subject;
  let newCommodity = keeper.commodity;
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      if (typeof j.subject === "string" && j.subject.trim()) newSubject = j.subject.trim().slice(0, 200);
      if (typeof j.commodity === "string" && j.commodity.trim()) newCommodity = j.commodity.trim().slice(0, 200);
    } catch { /* keep keeper's */ }
  }

  // Move every loser's threads onto the keeper, then delete the loser.
  for (const loser of losers) {
    await prisma.emailThread.updateMany({
      where: { inquiryId: loser.id, officeId: session.officeId },
      data: { inquiryId: keeper.id },
    });
    if (loser.job?.id) {
      await prisma.job.deleteMany({ where: { id: loser.job.id, officeId: session.officeId } }).catch(() => {});
    }
    await prisma.carrierQuote.deleteMany({ where: { inquiryId: loser.id, inquiry: { officeId: session.officeId } } }).catch(() => {});
    await prisma.inquiry.deleteMany({ where: { id: loser.id, officeId: session.officeId } }).catch(() => {});
  }

  // Apply operator overrides if provided.
  const finalSubject = args.subject?.trim() || newSubject;
  const finalCommodity = args.commodity?.trim() || newCommodity;
  const finalOrigin = args.origin?.trim() ?? null;
  const finalDestination = args.destination?.trim() ?? null;
  const finalWeight = typeof args.weightKg === "number" ? args.weightKg : null;

  // Update the keeper with the merged subject + commodity, and append an audit note.
  const auditNote = `\n\n[Auto-consolidated ${losers.length} inquiries on ${new Date().toISOString().split("T")[0]}: ${losers.map((l) => `"${l.subject}"`).join(", ")}]`;
  const keeperInqData: Record<string, unknown> = {
    subject: finalSubject,
    commodity: finalCommodity,
  };
  if (finalOrigin) keeperInqData.origin = finalOrigin;
  if (finalDestination) keeperInqData.destination = finalDestination;
  if (finalWeight != null) keeperInqData.weight = finalWeight;
  await prisma.inquiry.update({
    where: { id: keeper.id },
    data: keeperInqData,
  });
  await prisma.$executeRaw`UPDATE "Inquiry" SET "notes" = COALESCE("notes", '') || ${auditNote} WHERE "id" = ${keeper.id}`;

  // If the keeper already has a load, propagate the new subject/commodity to it.
  const keeperJob = await prisma.job.findFirst({
    where: { inquiryId: keeper.id, officeId: session.officeId },
    select: { id: true, commodity: true, origin: true, destination: true, weight: true },
  });
  if (keeperJob) {
    const jobUpdate: Record<string, unknown> = {};
    if ((keeperJob.commodity == null || keeperJob.commodity === "")) jobUpdate.commodity = finalCommodity;
    else if (args.commodity) jobUpdate.commodity = finalCommodity;     // operator override always wins
    if (finalOrigin && (keeperJob.origin == null || args.origin)) jobUpdate.origin = finalOrigin;
    if (finalDestination && (keeperJob.destination == null || args.destination)) jobUpdate.destination = finalDestination;
    if (finalWeight != null && (keeperJob.weight == null || args.weightKg)) jobUpdate.weight = finalWeight;
    if (Object.keys(jobUpdate).length > 0) {
      await prisma.job.updateMany({ where: { id: keeperJob.id, officeId: session.officeId }, data: jobUpdate });
    }
  }

  revalidatePath("/dashboard/rfq");
  revalidatePath("/dashboard/inbox");
  revalidatePath("/dashboard/jobs");
  return {
    ok: true,
    mergedCount: losers.length,
    keeperInquiryId: keeper.id,
    keeperJobId: keeperJob?.id ?? null,
    subject: finalSubject,
  };
}
