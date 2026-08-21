export const SUPPLIER_RESEARCH_CAMPAIGN_ANCESTRY_WINDOW = 50;

export type SupplierResearchCampaignAncestryRow = {
  id: string;
  parentRunId: string | null;
  depth: number;
};

export function validateSupplierResearchCampaignAncestryWindow(
  rows: SupplierResearchCampaignAncestryRow[],
) {
  if (!rows.length || rows.length > SUPPLIER_RESEARCH_CAMPAIGN_ANCESTRY_WINDOW) {
    throw new Error("Supplier research campaign ancestry is invalid.");
  }
  const ids = new Set<string>();
  for (const [index, row] of rows.entries()) {
    if (
      !row.id
      || ids.has(row.id)
      || row.depth !== index + 1
      || (index > 0 && rows[index - 1].parentRunId !== row.id)
    ) {
      throw new Error("Supplier research campaign ancestry is invalid.");
    }
    ids.add(row.id);
  }
  const last = rows.at(-1)!;
  const truncated = rows.length === SUPPLIER_RESEARCH_CAMPAIGN_ANCESTRY_WINDOW && last.parentRunId !== null;
  if (!truncated && last.parentRunId !== null) {
    throw new Error("Supplier research campaign ancestry is invalid.");
  }
  return { ids: rows.map((row) => row.id), truncated };
}

export type SupplierResearchProvider = "EXA" | "OPENAI";
