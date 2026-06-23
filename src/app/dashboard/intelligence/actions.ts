"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { runManualMarketIngestion } from "@/lib/market-intelligence/manual-ingestion";
import type { ManualMarketIngestionActionState } from "./manual-action-types";

export async function runManualMarketIngestionAction(
  _previousState: ManualMarketIngestionActionState,
  formData: FormData,
): Promise<ManualMarketIngestionActionState> {
  const session = await requireSession();
  const sourceId = String(formData.get("source_id") ?? "").trim();
  const mode = String(formData.get("mode") ?? "preview").trim();

  const summary = await runManualMarketIngestion({
    officeId: session.officeId,
    role: session.role,
    sourceId,
    mode,
  }).catch((error) => ({
    ok: false,
    mode: mode === "live" ? "live" as const : "preview" as const,
    sourceId,
    sourceName: sourceId,
    message: error instanceof Error ? error.message : String(error),
    runIds: [],
    candidateUrls: [],
    researchItemsCreated: 0,
    marketSignalsCreated: 0,
    marketSignalLinksCreated: 0,
    marketImpactReviewsCreated: 0,
    extractionSkips: 0,
    duplicateOrSkippedCandidates: 0,
    providerErrors: [error instanceof Error ? error.message : String(error)],
  }));

  revalidatePath("/dashboard/intelligence");
  return {
    ok: summary.ok,
    mode: summary.mode,
    message: summary.message,
    summary,
  };
}
