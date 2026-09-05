import { Prisma, type Prisma as PrismaTypes } from "@prisma/client";

export const RESEARCH_STAGES = ["unscreened", "target", "not_target", "enriched", "has_email", "no_email"] as const;
export type ResearchRecordStage = (typeof RESEARCH_STAGES)[number];
export const EMAIL_STAGE_MARKER = "@";

export function isUnscreenedVerdict(value: unknown) {
  return value !== "target" && value !== "not_target";
}

export function hasEmailForStage(data: { email?: unknown }) {
  return typeof data.email === "string" && data.email.includes(EMAIL_STAGE_MARKER);
}

export function researchRecordStageWhere(stage?: string): PrismaTypes.ResearchRecordWhereInput {
  if (!stage || !RESEARCH_STAGES.includes(stage as ResearchRecordStage)) return {};
  const key = "fit_verdict";
  if (stage === "target" || stage === "not_target") return { data: { path: [key], equals: stage } };
  if (stage === "unscreened") {
    return {
      OR: [
        { data: { path: [key], equals: Prisma.AnyNull } },
        { AND: [{ data: { path: [key], not: "target" } }, { data: { path: [key], not: "not_target" } }] },
      ],
    };
  }
  if (stage === "enriched") {
    return {
      AND: [
        { data: { path: [key], equals: "target" } },
        { data: { path: ["email"], string_contains: EMAIL_STAGE_MARKER } },
      ],
    };
  }
  if (stage === "has_email") return { data: { path: ["email"], string_contains: EMAIL_STAGE_MARKER } };
  return {
    OR: [
      { data: { path: ["email"], equals: Prisma.AnyNull } },
      { NOT: { data: { path: ["email"], string_contains: EMAIL_STAGE_MARKER } } },
    ],
  };
}
