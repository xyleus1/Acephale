import type { ManualMarketIngestionMode, ManualMarketIngestionSummary } from "@/lib/market-intelligence/manual-ingestion";

export type ManualMarketIngestionActionState = {
  ok: boolean;
  mode?: ManualMarketIngestionMode;
  message: string;
  summary?: ManualMarketIngestionSummary;
};

export const initialManualMarketIngestionState: ManualMarketIngestionActionState = {
  ok: false,
  message: "No manual ingestion run yet.",
};
