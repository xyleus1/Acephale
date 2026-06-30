"use server";

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "./prisma";

export type StuckJob = {
  jobId: string;
  reference: string;
  status: string;
  type: string;
  customer: string | null;
  daysStuck: number;
  lastActivity: string;
  suggestion: string;
};

// A job is "stuck" if it hasn't progressed in N days based on:
// - status hasn't changed (we approximate by job.updatedAt)
// - no inbound/outbound message on its threads in N days
// AI suggests the next action per stuck job.
export async function findStuckJobs(officeId: string, opts: { daysThreshold?: number; max?: number } = {}): Promise<StuckJob[]> {
  const days = opts.daysThreshold ?? 5;
  const max = opts.max ?? 20;
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);

  const jobs = await prisma.job.findMany({
    where: {
      officeId,
      status: { notIn: ["DELIVERED", "CANCELLED", "PROPOSED"] },
      updatedAt: { lt: cutoff },
    },
    include: {
      company: { select: { name: true } },
      inquiry: { select: { commodity: true } },
      emailThreads: {
        select: { lastMessageAt: true, subject: true },
        orderBy: { lastMessageAt: "desc" },
        take: 1,
      },
      milestones: { select: { type: true, plannedAt: true, actualAt: true } },
    },
    orderBy: { updatedAt: "asc" },
    take: max,
  });

  if (jobs.length === 0) return [];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const client = apiKey ? new Anthropic({ apiKey }) : null;

  const out: StuckJob[] = [];
  for (const j of jobs) {
    const lastEmail = j.emailThreads[0]?.lastMessageAt ?? j.updatedAt;
    const daysStuck = Math.floor((Date.now() - new Date(lastEmail).getTime()) / (24 * 3600 * 1000));
    const milestones = j.milestones.map((m) => `${m.type}=${m.actualAt ? "done" : m.plannedAt ? "planned" : "open"}`).join(", ");

    let suggestion = "Follow up — last activity was over " + daysStuck + " days ago.";
    if (client) {
      try {
        const result = await client.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 120,
          system: `You suggest the SINGLE next concrete action for a freight job that has been stagnant. Reply in one short sentence. No emojis. No preamble.`,
          messages: [{
            role: "user",
            content: `Job ${j.reference} (${j.type}, status ${j.status}, ${j.company?.name ?? "no customer"}) — ${j.origin ?? "?"} → ${j.destination ?? "?"}, commodity ${j.inquiry?.commodity ?? "—"}. Milestones: ${milestones || "none"}. Last email ${daysStuck}d ago. What's the single most useful action to move it forward?`,
          }],
        });
        const text = result.content[0].type === "text" ? result.content[0].text : "";
        if (text.trim()) suggestion = text.trim();
      } catch { /* keep default */ }
    }
    out.push({
      jobId: j.id,
      reference: j.reference,
      status: j.status,
      type: j.type,
      customer: j.company?.name ?? null,
      daysStuck,
      lastActivity: new Date(lastEmail).toISOString(),
      suggestion,
    });
  }
  return out;
}
