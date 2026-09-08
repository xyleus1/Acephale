export type OpsPortfolioMatch = {
  kind: "office" | "company" | "list" | "campaign" | "workflowAccount";
  officeId: string;
  officeName: string;
  id: string;
  name: string;
};

export type OpsPortfolioOffice = OpsPortfolioOfficeInput["office"] & Omit<OpsPortfolioOfficeInput, "office">;

export type OpsPortfolioOfficeInput = {
  office: {
    id: string;
    name: string;
    createdAt: string;
  };
  companies: Array<{ id: string; name: string }>;
  companiesTotal: number;
  workflowAccounts: Array<{
    id: string;
    companyId: string;
    companyName: string;
    name: string;
  }>;
  researchLists: Array<{
    id: string;
    slug: string;
    name: string;
    records: {
      total: number;
      byStatus: Record<string, number>;
    };
  }>;
  campaigns: Array<{
    id: string;
    name: string;
    status: string;
    replyMode: string;
    listId: string;
    sends: { total: number; sent: number; rejected: number };
    followUps: { total: number; sent: number; skipped: number };
    replies: {
      threads: number;
      answered: number;
      awaitingAnswer: number;
      autoReplies: number;
      bounces: number;
      optOuts: number;
      complaints: number;
    };
    autoReplyLedger: {
      sent: number;
      escalated: number;
      suppressed: number;
      skipped: number;
      failed: number;
    };
  }>;
  emailThreads: {
    total: number;
    inbound: number;
    outbound: number;
  };
  procurement: Array<{
    customerId: string;
    companyName?: string;
    orders?: number;
    suppliers?: number;
    contacted?: number;
    responses?: number;
    byStatus?: Record<string, number>;
    error?: "unavailable";
  }>;
};

export type OpsPortfolioReport = {
  generatedAt: string;
  offices: OpsPortfolioOffice[];
  matches?: OpsPortfolioMatch[];
};

export function buildOpsPortfolioReport(input: {
  generatedAt: string;
  offices: OpsPortfolioOfficeInput[];
  matches?: OpsPortfolioMatch[];
}): OpsPortfolioReport {
  return {
    generatedAt: input.generatedAt,
    offices: input.offices.map(({ office, ...data }) => ({
      ...office,
      ...data,
    })),
    ...(input.matches ? { matches: input.matches } : {}),
  };
}

export function findOpsPortfolioMatches(
  query: string,
  entries: readonly OpsPortfolioMatch[],
): OpsPortfolioMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return entries.filter((entry) => entry.name.toLowerCase().includes(needle));
}
