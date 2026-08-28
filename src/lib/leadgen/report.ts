export type LeadDiscoveryReportRow = {
  provider: string;
  engine: string;
  campaignTag: string;
  profileSlug: string;
  persisted: boolean;
  contactFound: boolean;
  usableContact: boolean;
  bestEmailVerdict: string | null;
};

export type LeadGenReportRun = {
  profileSlug: string;
  campaignTag: string;
  startedAt: Date;
  status: string;
  queriesUsed: number;
  pagesFetched: number;
  candidatesFound: number;
  companiesCreated: number;
  error: string | null;
  providerStats: unknown;
};

export type LeadGenProviderReport = {
  provider: string;
  queries: number;
  hits: number;
  candidates: number;
  companiesPersisted: number;
  contactNumerator: number;
  contactDenominator: number;
  usableContactNumerator: number;
  usableContactDenominator: number;
  deliverableNumerator: number;
  deliverableDenominator: number;
};

export type LeadGenProjectReport = {
  key: string;
  queries: number;
  discoveries: number;
  companiesPersisted: number;
  contactNumerator: number;
  contactDenominator: number;
  usableContactNumerator: number;
  usableContactDenominator: number;
};

export type LeadDiscoveryReport = {
  providers: LeadGenProviderReport[];
  campaigns: LeadGenProjectReport[];
  profiles: LeadGenProjectReport[];
  runs: LeadGenReportRun[];
};

type ProviderStats = {
  queries: number;
  hits: number;
  candidates: number;
};

function providerStats(value: unknown): Record<string, ProviderStats> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([provider, raw]) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
      const item = raw as Record<string, unknown>;
      const integer = (candidate: unknown) => typeof candidate === "number" && Number.isFinite(candidate)
        ? Math.max(0, Math.floor(candidate))
        : 0;
      return [[provider, {
        queries: integer(item.queries),
        hits: integer(item.hits),
        candidates: integer(item.candidates),
      }]];
    }),
  );
}

function providerIdentity(row: Pick<LeadDiscoveryReportRow, "provider" | "engine">) {
  return row.provider === "html" && row.engine ? `html:${row.engine}` : row.provider;
}

function projectRows(rows: LeadDiscoveryReportRow[], runs: LeadGenReportRun[], field: "campaignTag" | "profileSlug") {
  const grouped = new Map<string, LeadGenProjectReport>();
  for (const run of runs) {
    const key = run[field];
    const current = grouped.get(key) ?? {
      key,
      queries: 0,
      discoveries: 0,
      companiesPersisted: 0,
      contactNumerator: 0,
      contactDenominator: 0,
      usableContactNumerator: 0,
      usableContactDenominator: 0,
    };
    current.queries += run.queriesUsed;
    grouped.set(key, current);
  }
  for (const row of rows) {
    const key = row[field];
    const current = grouped.get(key) ?? {
      key,
      queries: 0,
      discoveries: 0,
      companiesPersisted: 0,
      contactNumerator: 0,
      contactDenominator: 0,
      usableContactNumerator: 0,
      usableContactDenominator: 0,
    };
    current.discoveries += 1;
    if (row.persisted) current.companiesPersisted += 1;
    current.contactDenominator += 1;
    if (row.contactFound) current.contactNumerator += 1;
    current.usableContactDenominator += 1;
    if (row.usableContact) current.usableContactNumerator += 1;
    grouped.set(key, current);
  }
  return [...grouped.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function calculateLeadDiscoveryReport(
  rows: readonly LeadDiscoveryReportRow[],
  runs: readonly LeadGenReportRun[],
): LeadDiscoveryReport {
  const providers = new Map<string, LeadGenProviderReport>();
  for (const run of runs) {
    for (const [provider, stats] of Object.entries(providerStats(run.providerStats))) {
      const current = providers.get(provider) ?? {
        provider,
        queries: 0,
        hits: 0,
        candidates: 0,
        companiesPersisted: 0,
        contactNumerator: 0,
        contactDenominator: 0,
        usableContactNumerator: 0,
        usableContactDenominator: 0,
        deliverableNumerator: 0,
        deliverableDenominator: 0,
      };
      current.queries += stats.queries;
      current.hits += stats.hits;
      current.candidates += stats.candidates;
      providers.set(provider, current);
    }
  }
  for (const row of rows) {
    const provider = providerIdentity(row);
    const current = providers.get(provider) ?? {
      provider,
      queries: 0,
      hits: 0,
      candidates: 0,
      companiesPersisted: 0,
      contactNumerator: 0,
      contactDenominator: 0,
      usableContactNumerator: 0,
      usableContactDenominator: 0,
      deliverableNumerator: 0,
      deliverableDenominator: 0,
    };
    if (row.persisted) current.companiesPersisted += 1;
    current.contactDenominator += 1;
    if (row.contactFound) current.contactNumerator += 1;
    current.usableContactDenominator += 1;
    if (row.usableContact) current.usableContactNumerator += 1;
    current.deliverableDenominator += 1;
    if (row.bestEmailVerdict === "deliverable_likely") current.deliverableNumerator += 1;
    providers.set(provider, current);
  }
  return {
    providers: [...providers.values()].sort((a, b) => a.provider.localeCompare(b.provider)),
    campaigns: projectRows([...rows], [...runs], "campaignTag"),
    profiles: projectRows([...rows], [...runs], "profileSlug"),
    runs: [...runs].sort((a, b) => b.startedAt.valueOf() - a.startedAt.valueOf()),
  };
}

export function percentage(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : null;
}
