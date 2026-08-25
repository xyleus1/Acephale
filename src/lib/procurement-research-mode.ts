export type ProcurementResearchMode = "bourne" | "derya";

export function parseProcurementResearchMode(value: unknown): ProcurementResearchMode {
  return value === "derya" ? "derya" : "bourne";
}

export function procurementResearchMode(): ProcurementResearchMode {
  return parseProcurementResearchMode(process.env.PROCUREMENT_RESEARCH_MODE);
}
