// Meta (Instagram/Facebook) Lead Ads export sheets, one per ad market. Every
// export shares Meta's column layout — id, created_time, ad/campaign/form
// metadata, six form answers, budget, origin, destination, commodity, contact
// fields, job title, inbox url, lead status — so one parser serves all of
// them; only the spreadsheet, the market tag, and the customer-facing
// language differ.

export type MetaLeadMarket = "TR" | "US";

export type MetaLeadsSource = {
  market: MetaLeadMarket;
  spreadsheetId: string;
  tab: string;
  gid: string;
  // Label for memory-layer records ("Meta leads (Sayfa1)").
  sourceLabel: string;
  // Inquiry subject prefix ("Meta lead: …" / "US lead: …").
  subjectPrefix: string;
};

const TR_DEFAULT_SHEET_ID = "12Fvi6qzU_TLx-a5X49ggV5dyxDqFfLnDG3TTpuxlrlA";
// "DERYA LEAD - USA CALIFORNIA" — the US export campaign's lead sheet.
const US_DEFAULT_SHEET_ID = "1wSZBm5iNbDWjml5ddMebULb7iLBKjs5vuX3U_5oC_Ic";

export function metaLeadsSources(): MetaLeadsSource[] {
  const trTab = process.env.DERYA_META_LEADS_SHEET_TAB ?? "Sayfa1";
  const usTab = process.env.DERYA_META_LEADS_US_SHEET_TAB ?? "ca leads";
  return [
    {
      market: "TR",
      spreadsheetId: process.env.DERYA_META_LEADS_SHEET_ID ?? TR_DEFAULT_SHEET_ID,
      tab: trTab,
      gid: process.env.DERYA_META_LEADS_SHEET_GID ?? "0",
      // Pre-US records were labeled exactly this way; keep it stable.
      sourceLabel: `Meta leads (${trTab})`,
      subjectPrefix: "Meta lead",
    },
    {
      market: "US",
      spreadsheetId: process.env.DERYA_META_LEADS_US_SHEET_ID ?? US_DEFAULT_SHEET_ID,
      // The leads live in the "ca leads" tab; the spreadsheet's gid-0 tab
      // ("Sayfa1") holds only a header row.
      tab: usTab,
      gid: process.env.DERYA_META_LEADS_US_SHEET_GID ?? "86480056",
      sourceLabel: `Meta leads US (${usTab})`,
      subjectPrefix: "US lead",
    },
  ];
}

export function metaLeadsSource(market: MetaLeadMarket): MetaLeadsSource {
  return metaLeadsSources().find((s) => s.market === market)!;
}

// parsedData substring that marks a lead as US-market — used both when the
// sync writes rows and when /dashboard/rfq splits them into the US panel.
// Nothing else writes a "market" key into inquiry parsedData.
export const US_LEAD_PARSED_MARKER = '"market":"US"' as const;

// Market of a lead inquiry, from its (already-parsed) parsedData. TR leads
// predate the market tag, so anything unmarked is TR.
export function metaLeadMarketOf(parsed: Record<string, unknown>): MetaLeadMarket {
  return parsed.market === "US" ? "US" : "TR";
}

export function metaLeadsSheetUrl(source: Pick<MetaLeadsSource, "spreadsheetId" | "gid">): string {
  return `https://docs.google.com/spreadsheets/d/${source.spreadsheetId}/edit#gid=${source.gid}`;
}
