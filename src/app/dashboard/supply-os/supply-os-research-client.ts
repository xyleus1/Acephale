import type { SupplyCompanyResearch } from "@/lib/supply-os-case-model";

export async function requestCompanyResearch(query: string): Promise<SupplyCompanyResearch> {
  const response = await window.fetch("/api/supply-os/company-research", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await response.json().catch(() => null) as { research?: SupplyCompanyResearch; error?: string } | null;
  if (!response.ok || !body?.research) {
    throw new Error(body?.error || "Company research failed.");
  }
  return body.research;
}
