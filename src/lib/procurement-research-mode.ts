import { procurementWorkflowOwner } from "@/lib/procurement-workflow-owner";

export type ProcurementResearchMode = "bourne" | "derya";

export function parseProcurementResearchMode(value: unknown): ProcurementResearchMode {
  return value === "derya" ? "derya" : "bourne";
}

export function procurementResearchMode(): ProcurementResearchMode {
  const configured = process.env.PROCUREMENT_RESEARCH_MODE;
  if (configured === "derya" || configured === "bourne") return configured;
  return procurementWorkflowOwner() === "bourne" ? "bourne" : "derya";
}
