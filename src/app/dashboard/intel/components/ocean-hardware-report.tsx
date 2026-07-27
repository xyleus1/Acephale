import { Icon } from "@/components/icon";
import {
  STARTUP_HARDWARE_CATEGORY_LABELS,
  STARTUP_PRODUCTION_HARDWARE_BASKET,
  WEST_COAST_GATEWAY_DISTRICTS,
  dedupeIntelSourceUses,
  resolveIntelSourceUse,
  type CensusPublicReportStatus,
  type CensusPublicOriginCorridorWatch,
  type ChinaCustomsDecisionGuide,
  type IntelSourceUse,
  type OceanHardwareModeTotals,
  type OceanHardwareResearchReport,
  type OceanHardwareRoutingResearchBrief,
  type StartupHardwareCategory,
} from "@/lib/intel";
import { ChinaCorridorWatch } from "./china-corridor-watch";
import { IntelReportActions } from "./intel-report-actions";
import styles from "./intel-report.module.css";

export type CensusReportStatus = CensusPublicReportStatus;

type OceanHardwareReportProps = {
  california: OceanHardwareResearchReport;
  gateways: OceanHardwareResearchReport;
  census: CensusReportStatus;
  chinaWatch: CensusPublicOriginCorridorWatch;
  chinaRoutingBrief: OceanHardwareRoutingResearchBrief;
  chinaCustomsGuide: ChinaCustomsDecisionGuide;
  providerSources?: readonly IntelSourceUse[];
};

const CATEGORY_ORDER: StartupHardwareCategory[] = [
  "factory_process",
  "compute_electronics",
  "power_control",
  "medical_lab",
  "drones_aerospace",
];

const CATEGORY_SHORT_LABELS: Record<StartupHardwareCategory, string> = {
  factory_process: "Factory + process",
  compute_electronics: "Compute + electronics",
  power_control: "Power + control",
  medical_lab: "Medical + lab",
  drones_aerospace: "Drones + aerospace",
};

function compactUsd(value: number | null): string {
  if (value == null) return "Not loaded";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: value >= 1_000_000_000 ? 2 : 1,
  }).format(value);
}

function compactWeight(value: number | null): string {
  if (value == null) return "Not reported";
  return `${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)} kg`;
}

function formatDate(value: string | null): string {
  if (!value) return "Not stated";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatMonth(value: string): string {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1))
  );
}

function formatTimestamp(value: string | null): string {
  if (!value) return "Not stated";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not stated";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

function sumNullable(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value != null);
  return present.length > 0 ? present.reduce((sum, value) => sum + value, 0) : null;
}

function latestTotals(report: OceanHardwareResearchReport): OceanHardwareModeTotals {
  return report.years.at(-1)?.totals ?? {
    vesselValueUsd: null,
    vesselWeightKg: null,
    airValueUsd: null,
    airWeightKg: null,
  };
}

function sourceKey(source: IntelSourceUse): string {
  return `${source.sourceId}|${source.sourceUrl}`;
}

function SourceRef({
  sources,
  indexByKey,
}: {
  sources: readonly IntelSourceUse[];
  indexByKey: ReadonlyMap<string, number>;
}) {
  const indexes = [
    ...new Set(
      sources
        .map((source) => indexByKey.get(sourceKey(source)))
        .filter((index): index is number => index != null)
    ),
  ].sort((a, b) => a - b);
  if (indexes.length === 0) return null;
  return (
    <span className={styles.sourceRefs} aria-label={`Supporting sources ${indexes.map((index) => `S${index}`).join(", ")}`}>
      {indexes.map((index) => (
        <a className={styles.sourceRef} href={`#source-s${index}`} aria-label={`Open source S${index}`} key={index}>
          S{index}
        </a>
      ))}
    </span>
  );
}

function Metric({
  label,
  value,
  detail,
  pending = false,
  source,
}: {
  label: string;
  value: string;
  detail: string;
  pending?: boolean;
  source?: React.ReactNode;
}) {
  return (
    <div className={styles.metric}>
      <div className={styles.metricLabel}>
        {label} {source}
      </div>
      <div className={pending ? styles.metricValuePending : styles.metricValue}>{value}</div>
      <div className={styles.metricDetail}>{detail}</div>
    </div>
  );
}

function yearTotals(report: OceanHardwareResearchReport, year: number): OceanHardwareModeTotals {
  return (
    report.years.find((entry) => entry.year === year)?.totals ?? {
      vesselValueUsd: null,
      vesselWeightKg: null,
      airValueUsd: null,
      airWeightKg: null,
    }
  );
}

function topOriginRows(report: OceanHardwareResearchReport, limit = 8) {
  const ranked = report.currentCountries.filter(
    (country) => (country.totals.vesselValueUsd ?? 0) > 0
  );
  const top = ranked.slice(0, limit);
  const remaining = ranked.slice(limit);
  if (remaining.length === 0) return top;
  return [
    ...top,
    {
      countryCode: "other",
      countryName: `Other ${remaining.length} origins`,
      totals: {
        vesselValueUsd: sumNullable(remaining.map((country) => country.totals.vesselValueUsd)),
        vesselWeightKg: sumNullable(remaining.map((country) => country.totals.vesselWeightKg)),
        airValueUsd: sumNullable(remaining.map((country) => country.totals.airValueUsd)),
        airWeightKg: sumNullable(remaining.map((country) => country.totals.airWeightKg)),
      },
      rowCount: remaining.reduce((sum, country) => sum + country.rowCount, 0),
      sources: dedupeIntelSourceUses(remaining.flatMap((country) => country.sources)),
    },
  ];
}

export function OceanHardwareReport({
  california,
  gateways,
  census,
  chinaWatch,
  chinaRoutingBrief,
  chinaCustomsGuide,
  providerSources = [],
}: OceanHardwareReportProps) {
  const sources = dedupeIntelSourceUses([
    ...california.document.sources,
    ...gateways.document.sources,
    ...california.observedCompanies.flatMap((company) => company.sources),
    ...chinaWatch.sources,
    ...chinaCustomsGuide.sources,
  ]);
  const evidenceSourceKeys = new Set(sources.map(sourceKey));
  const providerReferences = dedupeIntelSourceUses(providerSources).filter(
    (source) => !evidenceSourceKeys.has(sourceKey(source))
  );
  const companyBySourceKey = new Map(
    california.observedCompanies.flatMap((company) =>
      company.sources.map((source) => [sourceKey(source), company.companyName] as const)
    )
  );
  const sourceIndex = new Map(sources.map((source, index) => [sourceKey(source), index + 1]));
  const resolvedSources = sources.map((source, index) => ({
    number: index + 1,
    use: source,
    definition: resolveIntelSourceUse(source),
  }));
  const resolvedProviderReferences = providerReferences.map((use) => ({
    use,
    definition: resolveIntelSourceUse(use),
  }));
  const californiaLatest = latestTotals(california);
  const gatewayLatest = latestTotals(gateways);
  const californiaFetchedCensusSources = california.document.sources.filter(
    (source) => source.sourceId === "census_trade_downloads" && source.fetchedAt
  );
  const gatewayFetchedCensusSources = gateways.document.sources.filter(
    (source) => source.sourceId === "census_trade_downloads" && source.fetchedAt
  );
  const californiaMetricSources = california.years.at(-1)?.sources.length
    ? california.years.at(-1)?.sources ?? []
    : californiaFetchedCensusSources;
  const gatewayMetricSources = gateways.years.at(-1)?.sources.length
    ? gateways.years.at(-1)?.sources ?? []
    : gatewayFetchedCensusSources;
  const answerMetricSources = dedupeIntelSourceUses([
    ...californiaMetricSources,
    ...gatewayMetricSources,
  ]);
  const countryNamingSources = sources.filter(
    (source) => source.sourceId === "census_schedule_c"
  );
  const hsRevisionSources = sources.filter((source) => source.sourceId === "usitc_hts");
  const companyEvidenceSources = dedupeIntelSourceUses(
    california.observedCompanies.flatMap((company) => company.sources)
  );
  const companyEvidenceReviewedDate = companyEvidenceSources
    .map((source) => source.reviewedAt)
    .filter((value): value is string => value != null)
    .sort()
    .at(-1)
    ?.slice(0, 10) ?? "date unavailable";
  const californiaLoaded = census.californiaCurrentLoaded;
  const gatewayLoaded = census.gatewayCurrentLoaded;
  const californiaComplete = californiaLoaded;
  const gatewayComplete = gatewayLoaded;
  const aggregateLoaded = californiaLoaded || gatewayLoaded;
  const currentScopesLoaded = californiaComplete && gatewayComplete;
  const completeYears = california.request.window.completeYears;
  const currentYear = california.request.window.currentYtdYear;
  const historicalLoaded = completeYears.every(
    (year) =>
      census.californiaLoadedYears.includes(year) &&
      census.gatewayLoadedYears.includes(year)
  );
  const fullyLoaded = currentScopesLoaded && historicalLoaded;
  const dataState: "complete" | "partial" | "unavailable" = fullyLoaded
    ? "complete"
    : aggregateLoaded
      ? "partial"
      : "unavailable";
  const directAnswerSources = aggregateLoaded ? answerMetricSources : companyEvidenceSources;
  const companyEvidence = california.observedCompanies;
  const periodLabel = `${completeYears[0]}-${completeYears.at(-1)} + ${currentYear} YTD`;
  const categoryCounts = new Map<StartupHardwareCategory, number>();
  for (const entry of STARTUP_PRODUCTION_HARDWARE_BASKET) {
    categoryCounts.set(entry.category, (categoryCounts.get(entry.category) ?? 0) + 1);
  }
  const containerShare =
    californiaLoaded && californiaLatest.vesselValueUsd && census.californiaContainerizedValueUsd != null
      ? (census.californiaContainerizedValueUsd / californiaLatest.vesselValueUsd) * 100
      : null;
  const californiaCoverageLabel = californiaComplete
    ? `Complete public file, ${census.californiaCurrentRowCount.toLocaleString("en-US")} matching records`
    : californiaLoaded
      ? "Partial public snapshot"
      : "Current California file unavailable";
  const gatewayCoverageLabel = gatewayComplete
    ? `Complete public file, ${census.gatewayCurrentRowCount.toLocaleString("en-US")} matching records`
    : gatewayLoaded
      ? "Partial public snapshot"
      : "Current West Coast port file unavailable";
  const californiaOrigins = topOriginRows(california);
  const gatewayOrigins = topOriginRows(gateways);
  const currentGatewayCorridors = gatewayComplete ? gateways.currentGatewayCorridors : [];
  const topGatewayCorridor = currentGatewayCorridors.at(0) ?? null;
  const topGateway =
    gatewayComplete
      ? [...gateways.currentGeographies]
          .filter((geography) => (geography.totals.vesselValueUsd ?? 0) > 0)
          .sort(
            (left, right) =>
              (right.totals.vesselValueUsd ?? 0) - (left.totals.vesselValueUsd ?? 0)
          )
          .at(0) ?? null
      : null;
  const topGatewayShare =
    topGateway?.totals.vesselValueUsd != null && gatewayLatest.vesselValueUsd
      ? (topGateway.totals.vesselValueUsd / gatewayLatest.vesselValueUsd) * 100
      : null;
  const corridorSources = dedupeIntelSourceUses(
    currentGatewayCorridors.flatMap((corridor) => corridor.sources)
  );
  const corridorValuesByCell = new Map<string, number>();
  for (const corridor of currentGatewayCorridors) {
    const key = `${corridor.category}|${corridor.gatewayDistrictCode}`;
    corridorValuesByCell.set(key, (corridorValuesByCell.get(key) ?? 0) + corridor.vesselValueUsd);
  }
  const largestCorridorCellValue = Math.max(1, ...corridorValuesByCell.values());
  const providerUrl = (sourceId: IntelSourceUse["sourceId"], pathPart: string) =>
    providerReferences.find(
      (source) => source.sourceId === sourceId && source.sourceUrl.endsWith(pathPart)
    )?.sourceUrl ?? "#sources";
  const providerReviewedDate =
    providerReferences
      .map((source) => source.reviewedAt?.slice(0, 10))
      .filter((value): value is string => value != null)
      .sort()
      .at(-1) ?? "date unavailable";
  const topCorridorShare =
    topGatewayCorridor && gatewayLatest.vesselValueUsd
      ? (topGatewayCorridor.vesselValueUsd / gatewayLatest.vesselValueUsd) * 100
      : null;

  return (
    <article className={styles.reportShell} aria-labelledby="hardware-report-title" data-intel-report>
      <header className={styles.reportHero}>
        <div className={styles.heroGrid} aria-hidden="true" />
        <div className={styles.heroTopline}>
          <div className={styles.reportKicker}>
            <span>Corridor watch 01</span>
            <span className={styles.kickerDivider} />
            <span>China origin</span>
          </div>
          <div className={styles.heroControls}>
            <div className={fullyLoaded ? styles.statusLive : styles.statusPartial}>
              <span className={styles.statusDot} />
              {dataState === "complete"
                ? "Official snapshot loaded"
                : dataState === "partial"
                  ? "Partial official snapshot"
                  : "Official snapshot unavailable"}
            </div>
            <IntelReportActions />
          </div>
        </div>

        <div className={styles.heroCopy}>
          <p className={styles.heroOverline}>China origin + U.S. West Coast arrival geography</p>
          <h1 id="hardware-report-title">China hardware corridor watch</h1>
          <p className={styles.heroSummary}>
            A cited operator report that turns official import aggregates into category-specific gateway research,
            while keeping route recommendations and lead claims blocked until shipment evidence is available.
          </p>
        </div>

        <div className={styles.scopeRail} aria-label="Report scope">
          <div>
            <span>Origin</span>
            <strong>China, Schedule C 5700</strong>
          </div>
          <div>
            <span>Commodity basis</span>
            <strong>46-code current, 43-code history</strong>
          </div>
          <div>
            <span>Arrival geography</span>
            <strong>Five U.S. West Coast districts</strong>
          </div>
          <div>
            <span>Mode</span>
            <strong>Vessel</strong>
          </div>
          <div>
            <span>Observation period</span>
            <strong>{formatMonth(census.asOfMonth)} YTD</strong>
          </div>
        </div>
      </header>

      <nav className={styles.reportNav} aria-label="Report sections">
        <a href="#china-watch">Watch</a>
        <a href="#china-history">History</a>
        <a href="#customs-guide">Customs</a>
        <a href="#routing-brief">Routing</a>
        <a href="#market-context">Market context</a>
        <a href="#sources">Evidence</a>
      </nav>

      <div className={styles.reportPaper}>
        <ChinaCorridorWatch
          watch={chinaWatch}
          brief={chinaRoutingBrief}
          customsGuide={chinaCustomsGuide}
          sourceIndex={sourceIndex}
          evidence={
            <SourceRef
              sources={chinaWatch.sources.filter(
                (source) =>
                  source.asOf === chinaWatch.asOfMonth &&
                  source.displayName?.startsWith("Port Imports HS6")
              )}
              indexByKey={sourceIndex}
            />
          }
        />

        <details className={styles.marketContextDetails} id="market-context">
          <summary className={styles.marketContextSummary}>
            <div>
              <span>Appendix A</span>
              <strong>Open the full all-origin market report</strong>
              <p>
                Review market scale, all origin countries, the complete hardware basket,
                provider research, and system requirements.
              </p>
            </div>
            <span className={styles.marketContextAction}>Full report</span>
          </summary>
        <section className={styles.section} id="answer">
          <div className={styles.sectionHeading}>
            <div className={styles.sectionNumber}>A1</div>
            <div>
              <p className={styles.sectionEyebrow}>Decision brief</p>
              <h2>What to investigate, and what not to claim</h2>
            </div>
          </div>

          <div className={styles.answerGrid}>
            <div className={styles.answerStatement}>
              <div className={styles.answerIcon}><Icon name="ship" size={20} /></div>
              <p className={styles.answerLead}>
                The public data is good enough to rank corridor research. It is not enough to choose an optimized route
                or contact a qualified lead.
              </p>
              <div className={styles.decisionFindingList}>
                <div className={styles.decisionFinding}>
                  <span className={styles.decisionFindingNumber}>01</span>
                  <div>
                    <span className={styles.decisionFindingLabel}>Research first</span>
                    <h3>
                      {topGatewayCorridor
                        ? `${topGatewayCorridor.countryName} to ${topGatewayCorridor.gatewayDistrictLabel}, ${topGatewayCorridor.categoryLabel}`
                        : "Rebuild the current West Coast corridor slice"}
                    </h3>
                    <p>
                      {topGatewayCorridor
                        ? `${compactUsd(topGatewayCorridor.vesselValueUsd)}, ${topCorridorShare?.toFixed(1) ?? "0.0"}% of current West Coast vessel value. Verify foreign loading ports, services, schedules, rates, and exception history next.`
                        : "Current joint origin, product, and gateway evidence is unavailable. Do not substitute separate marginal totals."}
                    </p>
                  </div>
                </div>
                <div className={styles.decisionFinding}>
                  <span className={styles.decisionFindingNumber}>02</span>
                  <div>
                    <span className={styles.decisionFindingLabel}>Stress-test concentration</span>
                    <h3>
                      {topGateway && topGatewayShare != null
                        ? `${topGateway.geographyLabel} carries ${topGatewayShare.toFixed(1)}% of current gateway value`
                        : "Gateway concentration is not available"}
                    </h3>
                    <p>
                      Compare alternate gateways only after rates, schedules, handling constraints, inland legs, and
                      disruption evidence are loaded. Aggregate mix does not prove rerouting feasibility.
                    </p>
                  </div>
                </div>
                <div className={styles.decisionFinding}>
                  <span className={styles.decisionFindingNumber}>03</span>
                  <div>
                    <span className={styles.decisionFindingLabel}>Hold lead outreach</span>
                    <h3>0 qualified leads in this report</h3>
                    <p>
                      The {companyEvidence.length} public company observations are examples only. Request one identical
                      licensed sample from each provider before scoring companies or drafting outreach.
                    </p>
                  </div>
                </div>
              </div>
              <div className={styles.answerFootnote}>
                <SourceRef sources={directAnswerSources} indexByKey={sourceIndex} />
                <span>Startup identity, route quality, and lead quality are never inferred from aggregate volume.</span>
              </div>
            </div>

            <aside className={styles.coveragePanel} aria-label="Coverage status">
              <div className={styles.coverageTitle}>
                <span>Coverage status</span>
                <small>{census.sourceFileCount} official import ZIPs</small>
              </div>
              <div className={styles.coverageRow}>
                <span>CA destination YTD</span>
                <strong className={californiaLoaded ? styles.coverageGood : styles.coverageGap}>
                  {californiaLoaded ? `Complete through ${formatMonth(census.asOfMonth)}` : "Unavailable"}
                </strong>
              </div>
              <div className={styles.coverageRow}>
                <span>West Coast ports YTD</span>
                <strong className={gatewayLoaded ? styles.coverageGood : styles.coverageGap}>
                  {gatewayLoaded ? `Complete through ${formatMonth(census.asOfMonth)}` : "Unavailable"}
                </strong>
              </div>
              <div className={styles.coverageRow}>
                <span>{completeYears[0]}-{completeYears.at(-1)} history</span>
                <strong className={historicalLoaded ? styles.coverageGood : styles.coverageGap}>
                  {historicalLoaded ? "5/5 years, both scopes" : "Incomplete"}
                </strong>
              </div>
              <div className={styles.coverageRow}>
                <span>Company-level ocean</span>
                <strong className={styles.coverageManual}>{companyEvidence.length} manual samples</strong>
              </div>
              <div className={styles.coverageRow}>
                <span>Company-level air</span>
                <strong className={styles.coverageGap}>Unavailable publicly</strong>
              </div>
              <div className={styles.coverageRow}>
                <span>Lead qualification</span>
                <strong className={styles.coverageNeutral}>0 qualified</strong>
              </div>
            </aside>
          </div>
        </section>

        <section className={styles.sectionFlush} id="scale">
          <div className={styles.sectionHeadingPadded}>
            <div className={styles.sectionNumber}>A2</div>
            <div>
              <p className={styles.sectionEyebrow}>Official market layer</p>
              <h2>Ocean first, air kept separate</h2>
            </div>
          </div>

          {aggregateLoaded ? (
            <>
              <div className={styles.metricBand}>
                <Metric
                  label="CA destination, vessel YTD"
                  value={compactUsd(californiaLoaded ? californiaLatest.vesselValueUsd : null)}
                  detail={`${californiaCoverageLabel}. Reported destination state.`}
                  pending={!californiaLoaded || californiaLatest.vesselValueUsd == null}
                  source={<SourceRef sources={californiaMetricSources} indexByKey={sourceIndex} />}
                />
                <Metric
                  label="West Coast ports, vessel YTD"
                  value={compactUsd(gatewayLoaded ? gatewayLatest.vesselValueUsd : null)}
                  detail={`${gatewayCoverageLabel}. Ports of unlading in districts 25, 27, 28, 29, and 30.`}
                  pending={!gatewayLoaded || gatewayLatest.vesselValueUsd == null}
                  source={<SourceRef sources={gatewayMetricSources} indexByKey={sourceIndex} />}
                />
                <Metric
                  label="CA vessel value containerized"
                  value={containerShare == null ? "Not loaded" : `${containerShare.toFixed(1)}%`}
                  detail={`${californiaCoverageLabel}. Share of vessel import value, not container count or shipment share.`}
                  pending={containerShare == null}
                  source={<SourceRef sources={californiaMetricSources} indexByKey={sourceIndex} />}
                />
                <Metric
                  label="CA destination, air YTD"
                  value={compactUsd(californiaLoaded ? californiaLatest.airValueUsd : null)}
                  detail={`${californiaCoverageLabel}. Aggregate comparison only, not company-level AWB data.`}
                  pending={!californiaLoaded || californiaLatest.airValueUsd == null}
                  source={<SourceRef sources={californiaMetricSources} indexByKey={sourceIndex} />}
                />
              </div>

              <div className={styles.sectionInner}>
                <div className={styles.subsectionHeader}>
                  <div>
                    <h3>Completed-year trend</h3>
                    <p>Revised December YTD files only. Current YTD stays in the metric band above.</p>
                  </div>
                  <span className={historicalLoaded ? styles.miniStatusGood : styles.miniStatusGap}>
                    {historicalLoaded ? "History loaded" : "History not loaded"}
                  </span>
                </div>

                {historicalLoaded ? (
                  <div className={styles.tableWrap}>
                    <table className={styles.dataTable}>
                      <caption>Official vessel import value by report geography and period</caption>
                      <thead>
                        <tr>
                          <th scope="col">Period</th>
                          <th scope="col">CA destination vessel</th>
                          <th scope="col">West Coast port vessel</th>
                          <th scope="col">Evidence state</th>
                        </tr>
                      </thead>
                      <tbody>
                        {completeYears.map((year) => {
                          const ca = yearTotals(california, year);
                          const west = yearTotals(gateways, year);
                          const californiaYearLoaded = census.californiaLoadedYears.includes(year);
                          const gatewayYearLoaded = census.gatewayLoadedYears.includes(year);
                          const yearComplete = californiaYearLoaded && gatewayYearLoaded;
                          const yearEvidenceSources = dedupeIntelSourceUses([
                            ...(california.years.find((entry) => entry.year === year)?.sources ?? []),
                            ...(gateways.years.find((entry) => entry.year === year)?.sources ?? []),
                          ]);
                          return (
                            <tr key={year}>
                              <td data-label="Period"><strong>{year}</strong></td>
                              <td data-label="CA destination vessel">{compactUsd(ca.vesselValueUsd)}</td>
                              <td data-label="West Coast port vessel">{compactUsd(west.vesselValueUsd)}</td>
                              <td data-label="Evidence state">
                                <span className={yearComplete ? styles.tableStatusGood : styles.tableStatusGap}>
                                  {yearComplete
                                    ? year === 2021
                                      ? "Complete files, 43-code basis"
                                      : "Complete files, 46-code basis"
                                    : "Scope file missing"}
                                </span>
                                <SourceRef sources={yearEvidenceSources} indexByKey={sourceIndex} />
                                {year === 2021 && (
                                  <SourceRef sources={hsRevisionSources} indexByKey={sourceIndex} />
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className={styles.historyGap}>
                    <strong>{completeYears[0]}-{completeYears.at(-1)} annual history is not loaded.</strong>
                    <p>Rebuild the durable public-file snapshot outside page rendering and preserve the last verified complete years.</p>
                  </div>
                )}

                <div className={styles.geographyNote}>
                  <div><Icon name="info" size={16} /></div>
                  <p>
                    <strong>Do not merge these geographies.</strong> California destination data describes the reported
                    state of ultimate destination. West Coast data describes ports of unlading within five coastal customs
                    districts. Neither view identifies the buyer or final delivery location.
                  </p>
                </div>
              </div>
            </>
          ) : (
            <div className={styles.dataBlocked}>
              <div className={styles.dataBlockedLead}>
                <div><Icon name="bar-chart" size={22} /></div>
                <div>
                  <span>Official aggregate snapshot unavailable</span>
                  <h3>The committed Census public-file snapshot could not be loaded</h3>
                  <p>
                    Treat this as an operational failure, not a zero. Rebuild the snapshot from the official State HS6
                    and Port HS6 downloads, then verify every requested period before publishing totals.
                  </p>
                  <a href="#sources">Review source status</a>
                </div>
              </div>
              <div className={styles.dataBlockedSteps}>
                <div>
                  <span>Current YTD</span>
                  <strong>Snapshot rebuild required</strong>
                  <p>Keyless official State HS6 and Port HS6 files.</p>
                </div>
                <div><span>{completeYears[0]}-{completeYears.at(-1)} history</span><strong>Preserve last good snapshot</strong><p>Never replace verified annual files with a partial run.</p></div>
                <div><span>Still available now</span><strong>{companyEvidence.length} company examples</strong><p>Manual public previews, not a complete importer list.</p></div>
              </div>
              <div className={styles.geographyNote}>
                <div><Icon name="info" size={16} /></div>
                <p>
                  <strong>Do not merge these geographies.</strong> California destination data and West Coast ports of
                  unlading answer different questions. Neither view identifies the buyer.
                </p>
              </div>
            </div>
          )}
        </section>

        <section className={styles.section} id="origins">
          <div className={styles.sectionHeadingSplit}>
            <div className={styles.sectionHeadingCompact}>
              <div className={styles.sectionNumber}>A3</div>
              <div>
                <p className={styles.sectionEyebrow}>Current origin mix</p>
                <h2>Where the hardware comes from</h2>
              </div>
            </div>
            <div className={styles.sampleLabel}>
              <strong>{formatMonth(census.asOfMonth)} YTD only</strong>
              <span>Country of origin, not loading port</span>
            </div>
          </div>

          <div className={styles.originGrid}>
            {[
              {
                title: "California destination",
                detail: "State of ultimate destination",
                rows: californiaOrigins,
                total: californiaLatest.vesselValueUsd,
                sources: dedupeIntelSourceUses([
                  ...californiaMetricSources,
                  ...countryNamingSources,
                ]),
              },
              {
                title: "West Coast ports",
                detail: "Ports of unlading in five coastal districts",
                rows: gatewayOrigins,
                total: gatewayLatest.vesselValueUsd,
                sources: dedupeIntelSourceUses([
                  ...gatewayMetricSources,
                  ...countryNamingSources,
                ]),
              },
            ].map((panel) => (
              <div className={styles.originPanel} key={panel.title}>
                <div className={styles.originPanelHeader}>
                  <div>
                    <h3>{panel.title}</h3>
                    <p>{panel.detail}</p>
                  </div>
                  <SourceRef sources={panel.sources} indexByKey={sourceIndex} />
                </div>
                <div className={styles.originTableWrap}>
                  <table className={styles.originTable}>
                    <caption>{panel.title} vessel imports by current-period country of origin</caption>
                    <thead>
                      <tr>
                        <th scope="col">Rank</th>
                        <th scope="col">Origin</th>
                        <th scope="col">Vessel value</th>
                        <th scope="col">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {panel.rows.map((country, index) => {
                        const share =
                          panel.total && country.totals.vesselValueUsd != null
                            ? (country.totals.vesselValueUsd / panel.total) * 100
                            : null;
                        return (
                          <tr key={`${panel.title}-${country.countryCode}`}>
                            <td data-label="Rank">{country.countryCode === "other" ? "-" : String(index + 1).padStart(2, "0")}</td>
                            <td data-label="Origin">
                              <strong>{country.countryName}</strong>
                              <div className={styles.originTrack} aria-hidden="true">
                                <span style={{ width: `${Math.min(100, Math.max(0, share ?? 0))}%` }} />
                              </div>
                            </td>
                            <td data-label="Vessel value">{compactUsd(country.totals.vesselValueUsd)}</td>
                            <td data-label="Share">{share == null ? "Not assessed" : `${share.toFixed(1)}%`}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>

          {currentGatewayCorridors.length > 0 && (
            <div className={styles.corridorWorkbench}>
              <div className={styles.corridorWorkbenchHeader}>
                <div>
                  <p className={styles.sectionEyebrow}>Joint current-period evidence</p>
                  <h3>Origin-product-gateway corridor signals</h3>
                  <span>
                    These cells come from the same Port Imports HS6 records. No cross-dataset join is used.
                  </span>
                </div>
                <div className={styles.corridorHeaderMeta}>
                  <strong>{currentGatewayCorridors.length.toLocaleString("en-US")} positive segments</strong>
                  <span>{formatMonth(census.asOfMonth)} YTD</span>
                  <SourceRef sources={corridorSources} indexByKey={sourceIndex} />
                </div>
              </div>

              <div className={styles.corridorMatrix} role="table" aria-label="Hardware category by West Coast gateway district">
                <div className={styles.corridorMatrixHeader} role="row">
                  <span role="columnheader">Hardware category</span>
                  {WEST_COAST_GATEWAY_DISTRICTS.map((district) => (
                    <span role="columnheader" key={district.code}>
                      District {district.code}
                      <small>{district.label}</small>
                    </span>
                  ))}
                </div>
                {CATEGORY_ORDER.map((category) => (
                  <div className={styles.corridorMatrixRow} role="row" key={category}>
                    <div className={styles.corridorCategoryCell} role="rowheader">
                      <strong>{CATEGORY_SHORT_LABELS[category]}</strong>
                      <span>Current vessel value</span>
                    </div>
                    {WEST_COAST_GATEWAY_DISTRICTS.map((district) => {
                      const value = corridorValuesByCell.get(`${category}|${district.code}`) ?? 0;
                      const share = gatewayLatest.vesselValueUsd
                        ? (value / gatewayLatest.vesselValueUsd) * 100
                        : 0;
                      const relativeWidth = (value / largestCorridorCellValue) * 100;
                      return (
                        <div className={styles.corridorMatrixCell} role="cell" key={district.code}>
                          <span className={styles.mobileCorridorDistrict}>District {district.code}</span>
                          <span
                            className={styles.corridorCellBar}
                            style={{ width: `${Math.max(value > 0 ? 3 : 0, relativeWidth)}%` }}
                            aria-hidden="true"
                          />
                          <strong>{compactUsd(value)}</strong>
                          <small>{share.toFixed(1)}% of West Coast</small>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>

              <details className={styles.corridorRankingDetails}>
                <summary className={styles.corridorRankingHeader}>
                  <div>
                    <h4>Highest-value corridor signals</h4>
                    <p>
                      Top 8 shown. The full {currentGatewayCorridors.length.toLocaleString("en-US")}-segment slice is in
                      the authenticated snapshot download.
                    </p>
                  </div>
                  <span>Ranked by current vessel value</span>
                </summary>
                <div className={styles.tableWrap}>
                  <table className={`${styles.dataTable} ${styles.corridorTable}`}>
                    <caption>Current origin-country, hardware-category, and gateway-district corridor signals</caption>
                    <thead>
                      <tr>
                        <th scope="col">Rank</th>
                        <th scope="col">Origin</th>
                        <th scope="col">Hardware category</th>
                        <th scope="col">Gateway district</th>
                        <th scope="col">Vessel value</th>
                        <th scope="col">West Coast share</th>
                        <th scope="col">Containerized value share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentGatewayCorridors.slice(0, 8).map((corridor, index) => {
                        const share = gatewayLatest.vesselValueUsd
                          ? (corridor.vesselValueUsd / gatewayLatest.vesselValueUsd) * 100
                          : 0;
                        const containerizedShare =
                          corridor.vesselValueUsd > 0
                            ? (corridor.containerizedVesselValueUsd / corridor.vesselValueUsd) * 100
                            : 0;
                        return (
                          <tr key={`${corridor.category}|${corridor.countryCode}|${corridor.gatewayDistrictCode}`}>
                            <td data-label="Rank"><strong>{String(index + 1).padStart(2, "0")}</strong></td>
                            <td data-label="Origin">{corridor.countryName}</td>
                            <td data-label="Hardware category">{CATEGORY_SHORT_LABELS[corridor.category]}</td>
                            <td data-label="Gateway district">
                              <strong>District {corridor.gatewayDistrictCode}</strong>
                              <span>{corridor.gatewayDistrictLabel}</span>
                            </td>
                            <td data-label="Vessel value">{compactUsd(corridor.vesselValueUsd)}</td>
                            <td data-label="West Coast share">{share.toFixed(1)}%</td>
                            <td data-label="Containerized value share">{containerizedShare.toFixed(1)}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>

              <div className={styles.corridorCaveat}>
                <Icon name="info" size={16} />
                <p>
                  <strong>This is an origin-country corridor signal, not a port-to-port lane.</strong> It does not
                  identify the foreign loading port, carrier, service, buyer, supplier, transit time, delay, or freight
                  rate. District 27 includes Los Angeles, Long Beach, Hueneme, and other district ports.
                </p>
              </div>
            </div>
          )}

          <div className={styles.gatewayBreakdown}>
            <div className={styles.gatewayBreakdownHeader}>
              <div>
                <p className={styles.sectionEyebrow}>Gateway concentration</p>
                <h3>West Coast port district mix</h3>
                <span>
                  Current vessel value by port-of-unlading district. District labels summarize every included port.
                </span>
              </div>
              <SourceRef sources={gatewayMetricSources} indexByKey={sourceIndex} />
            </div>
            <div className={styles.gatewayBreakdownGrid}>
              {gateways.currentGeographies.map((geography) => {
                const districtCode = geography.geographyKey.split(":").at(-1) ?? geography.geographyKey;
                const share =
                  gatewayLatest.vesselValueUsd && geography.totals.vesselValueUsd != null
                    ? (geography.totals.vesselValueUsd / gatewayLatest.vesselValueUsd) * 100
                    : null;
                return (
                  <div className={styles.gatewayBreakdownCard} key={geography.geographyKey}>
                    <span>District {districtCode}</span>
                    <h4>{geography.geographyLabel}</h4>
                    <strong>{compactUsd(geography.totals.vesselValueUsd)}</strong>
                    <div className={styles.gatewayTrack} aria-hidden="true">
                      <span style={{ width: `${Math.min(100, Math.max(0, share ?? 0))}%` }} />
                    </div>
                    <small>{share == null ? "Not assessed" : `${share.toFixed(1)}% of West Coast vessel value`}</small>
                  </div>
                );
              })}
            </div>
          </div>

          <div className={styles.geographyNote}>
            <div><Icon name="info" size={16} /></div>
            <p>
              <strong>Use this to prioritize corridor research, not lead claims.</strong> Country of origin reflects
              where goods were produced or substantially transformed. It does not identify a supplier, company, or
              foreign port of loading. The downloadable data preserves the full origin ranking behind each summarized
              table.
            </p>
          </div>
        </section>

        <section className={styles.section} id="basket">
          <div className={styles.sectionHeading}>
            <div className={styles.sectionNumber}>A4</div>
            <div>
              <p className={styles.sectionEyebrow}>Commodity definition</p>
              <h2>A declared proxy, not “all startup hardware”</h2>
            </div>
          </div>

          <div className={styles.basketIntro}>
            <p>
              “Hardware” is not a customs category. This report uses 46 HS groups spanning equipment a startup may buy
              to manufacture a product or import as the finished product. Broad raw materials and general road vehicles
              are excluded because they would swamp the signal. Current values below use the California destination
              file. <SourceRef sources={californiaMetricSources} indexByKey={sourceIndex} /> The HS 2022 revision is
              documented separately. <SourceRef sources={hsRevisionSources} indexByKey={sourceIndex} />
            </p>
            <div className={styles.basketCount}>
              <strong>{STARTUP_PRODUCTION_HARDWARE_BASKET.length}</strong>
              <span>HS groups in v1</span>
            </div>
          </div>

          <div className={styles.sectorList}>
            {CATEGORY_ORDER.map((category, index) => {
              const reportCategory = california.currentCategories.find((entry) => entry.category === category);
              return (
                <div className={styles.sectorRow} key={category}>
                  <span className={styles.sectorIndex}>{String(index + 1).padStart(2, "0")}</span>
                  <div className={styles.sectorName}>
                    <strong>{CATEGORY_SHORT_LABELS[category]}</strong>
                    <span>{STARTUP_HARDWARE_CATEGORY_LABELS[category]}</span>
                  </div>
                  <div className={styles.sectorCodes}>{categoryCounts.get(category)} HS groups</div>
                  <div className={styles.sectorValue}>
                    <span>CA vessel YTD</span>
                    <strong>{compactUsd(reportCategory?.totals.vesselValueUsd ?? null)}</strong>
                  </div>
                </div>
              );
            })}
          </div>

          <details className={styles.methodDetails}>
            <summary>Show all 46 HS groups and exclusions</summary>
            <div className={styles.codeGrid}>
              {CATEGORY_ORDER.map((category) => (
                <div key={category}>
                  <h4>{CATEGORY_SHORT_LABELS[category]}</h4>
                  <ul>
                    {STARTUP_PRODUCTION_HARDWARE_BASKET.filter((entry) => entry.category === category).map((entry) => (
                      <li key={entry.code}>
                        <code>{entry.code}</code>
                        <span>{entry.label}</span>
                        {entry.introducedYear && <small>Series begins {entry.introducedYear}</small>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </details>
        </section>

        <section className={styles.section} id="companies">
          <div className={styles.sectionHeadingSplit}>
            <div className={styles.sectionHeadingCompact}>
              <div className={styles.sectionNumber}>A5</div>
              <div>
                <p className={styles.sectionEyebrow}>Public bill-of-lading preview</p>
                <h2>Observed company evidence</h2>
              </div>
            </div>
            <div className={styles.sampleLabel}>
              <strong>Sample, not complete history</strong>
              <span>Source checked {companyEvidenceReviewedDate}</span>
            </div>
          </div>

          <div className={styles.companyTableWrap}>
            <table className={styles.companyTable}>
              <caption>Manually reviewed public company-level ocean shipment examples</caption>
              <thead>
                <tr>
                  <th scope="col">Observed importer profile</th>
                  <th scope="col">Shipment date</th>
                  <th scope="col">What moved</th>
                  <th scope="col">Origin</th>
                  <th scope="col">Weight</th>
                  <th scope="col">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {companyEvidence.map((company) => (
                  <tr key={company.id}>
                    <td data-label="Observed importer profile">
                      <strong>{company.companyName}</strong>
                      <span>{company.companyLocation ?? "Location not stated"}</span>
                    </td>
                    <td data-label="Shipment date">{formatDate(company.shipmentDate)}</td>
                    <td data-label="What moved">
                      <strong>{company.productDescription ?? "Description not stated"}</strong>
                      {company.hsCodes.length > 0 && <span>HS {company.hsCodes.join(", ")}</span>}
                    </td>
                    <td data-label="Origin">{company.originCountry ?? "Not stated reliably"}</td>
                    <td data-label="Weight">
                      {compactWeight(company.weightKg)}
                      {company.containerCount != null && (
                        <span>{company.containerCount} {company.containerCount === 1 ? "container" : "containers"}</span>
                      )}
                    </td>
                    <td data-label="Evidence">
                      <SourceRef sources={company.sources} indexByKey={sourceIndex} />
                      <span className={styles.observedTag}>Observed</span>
                      <details className={styles.companyEvidenceDetails}>
                        <summary>Record details</summary>
                        <dl>
                          <div><dt>Role</dt><dd>{company.observedRole.replaceAll("_", " ")}</dd></div>
                          {company.supplierName && <div><dt>Supplier</dt><dd>{company.supplierName}</dd></div>}
                          {company.arrivalPort && <div><dt>Arrival port</dt><dd>{company.arrivalPort}</dd></div>}
                          {company.billOfLadingNumber && <div><dt>BOL</dt><dd>{company.billOfLadingNumber}</dd></div>}
                          {company.caveats.length > 0 && <div><dt>Caveat</dt><dd>{company.caveats.join(" ")}</dd></div>}
                        </dl>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.companyWarning}>
            <Icon name="shield" size={16} />
            <p>
              These rows prove only that a named company appears on a reviewed public provider page. They do not prove
              total spend, complete shipment history, startup status, buying intent, or lead quality. Complete five-year
              company rankings require a licensed ocean bill-of-lading provider. The sample rows are not filtered to,
              or counted inside, the 46-code aggregate basket.
            </p>
          </div>

          <div className={styles.providerEvaluation}>
            <div className={styles.providerEvaluationHeader}>
              <div>
                <p className={styles.sectionEyebrow}>Licensed data acquisition gate</p>
                <h3>Test the same sample before buying any provider</h3>
                <span>Official provider pages reviewed {providerReviewedDate}. Vendor claims still require sample validation.</span>
              </div>
              <span className={styles.providerDecision}>Decision: request samples</span>
            </div>

            <div className={styles.providerComparison}>
              <article>
                <div className={styles.providerComparisonTop}>
                  <strong>ImportGenius</strong>
                  <span>Paid benchmark</span>
                </div>
                <h4>$449/month Pro</h4>
                <p>
                  Published U.S. coverage from 2006 to present, 50 searches per day, and 1,000 downloaded rows per month.
                  The provider says it does not offer a free trial.
                </p>
                <div className={styles.providerLinks}>
                  <a href={providerUrl("importgenius", "/pricing")} target="_blank" rel="noreferrer">
                    Pricing <Icon name="external" size={12} />
                  </a>
                  <a href={providerUrl("importgenius", "/us-imports")} target="_blank" rel="noreferrer">
                    U.S. fields <Icon name="external" size={12} />
                  </a>
                </div>
              </article>

              <article>
                <div className={styles.providerComparisonTop}>
                  <strong>TradeAtlas</strong>
                  <span>Sample first</span>
                </div>
                <h4>$2,950/year for 15 HS6 codes</h4>
                <p>
                  Published pricing includes importer, exporter, product, and port searches. Its public site offers a
                  free 2022 U.S. sample plus sample-file and API-trial request paths.
                </p>
                <div className={styles.providerLinks}>
                  <a href={providerUrl("tradeatlas", "/pricing-data-and-ai-package")} target="_blank" rel="noreferrer">
                    Pricing <Icon name="external" size={12} />
                  </a>
                  <a href={providerUrl("tradeatlas", "/en")} target="_blank" rel="noreferrer">
                    Sample path <Icon name="external" size={12} />
                  </a>
                </div>
              </article>

              <article>
                <div className={styles.providerComparisonTop}>
                  <strong>Trademo</strong>
                  <span>Sales validation</span>
                </div>
                <h4>Custom pricing</h4>
                <p>
                  Strong provider-claimed prospect, contact, and saved-workflow features. The FAQ claims a no-expiry free
                  trial and a 1-2 day data lag, but its public coverage counts conflict with the pricing page.
                </p>
                <div className={styles.providerLinks}>
                  <a href={providerUrl("trademo", "/intel/pricing")} target="_blank" rel="noreferrer">
                    Plan details <Icon name="external" size={12} />
                  </a>
                  <a href={providerUrl("trademo", "/faqs")} target="_blank" rel="noreferrer">
                    FAQ <Icon name="external" size={12} />
                  </a>
                </div>
              </article>
            </div>

            <details className={styles.sampleProtocol}>
              <summary>
                <span>Identical sample request</span>
                <strong>U.S. ocean hardware, same rows and rights</strong>
                <small>6 acceptance gates</small>
              </summary>
              <div className={styles.sampleProtocolBody}>
                <p>
                  April 1 to June 30, 2026 plus the same quarter in 2022-2025. Test HS6 847950, 850760, 854231, 902750,
                  and 880622. Keep West Coast arrival ports separate from importer addresses in CA, OR, and WA.
                </p>
                <ol className={styles.acceptanceGrid}>
                  <li><span>01</span><strong>History and freshness</strong><p>Five years available, update lag no more than 7 days.</p></li>
                  <li><span>02</span><strong>Shipment fields</strong><p>BOL hierarchy, dates, foreign and U.S. ports, vessel, weight, quantity, containers.</p></li>
                  <li><span>03</span><strong>Entity resolution</strong><p>At least 90% precision on the top 50 importers, intermediary contamination at or below 10%.</p></li>
                  <li><span>04</span><strong>Geography</strong><p>Arrival-port fields and importer state and ZIP are separately defined and at least 80% complete.</p></li>
                  <li><span>05</span><strong>Commodity relevance</strong><p>At least 85% relevant rows after BOL deduplication, with raw descriptions preserved.</p></li>
                  <li><span>06</span><strong>Commercial rights</strong><p>Written permission to store, normalize, score, and use the licensed data in Derya workflows.</p></li>
                </ol>
              </div>
            </details>
          </div>
        </section>

        <section className={styles.section} id="system">
          <div className={styles.sectionHeading}>
            <div className={styles.sectionNumber}>A6</div>
            <div>
              <p className={styles.sectionEyebrow}>Product implications</p>
              <h2>Recommended system actions</h2>
            </div>
          </div>

          <div className={styles.opportunityMatrix}>
            <div className={styles.matrixHeader}>
              <span>Priority</span><span>Workflow hypothesis</span><span>System action</span><span>Data gate</span>
            </div>
            <div className={styles.matrixRow}>
              <div><span className={styles.mobileMatrixLabel}>Priority</span><span className={styles.priorityNow}>Now</span></div>
              <div><span className={styles.mobileMatrixLabel}>Workflow hypothesis</span><strong>Shipment brief is incomplete</strong><p>Descriptions, HS codes, weights, packaging, and dates arrive fragmented.</p></div>
              <div><span className={styles.mobileMatrixLabel}>System action</span><strong>Normalize before quoting</strong><p>Extract fields, flag gaps, and produce an approval-ready ocean brief.</p></div>
              <div><span className={styles.mobileMatrixLabel}>Data gate</span><span className={styles.gateReady}>Existing workflow data</span></div>
            </div>
            <div className={styles.matrixRow}>
              <div><span className={styles.mobileMatrixLabel}>Priority</span><span className={styles.priorityNow}>Now</span></div>
              <div><span className={styles.mobileMatrixLabel}>Workflow hypothesis</span><strong>Classification changes cost and risk</strong><p>The proxy spans machinery, electronics, medical, power, and aerospace chapters.</p></div>
              <div><span className={styles.mobileMatrixLabel}>System action</span><strong>Explain classification options</strong><p>Retrieve rulings and duties, show evidence, and keep final approval with an operator.</p></div>
              <div><span className={styles.mobileMatrixLabel}>Data gate</span><span className={styles.gateReady}>HTS + CBP sources</span></div>
            </div>
            <div className={styles.matrixRow}>
              <div><span className={styles.mobileMatrixLabel}>Priority</span><span className={styles.priorityNext}>Next</span></div>
              <div><span className={styles.mobileMatrixLabel}>Workflow hypothesis</span><strong>Mode and gateway choices lack context</strong><p>Destination-state volume, customs entry, vessel, and air are currently conflated.</p></div>
              <div><span className={styles.mobileMatrixLabel}>System action</span><strong>Compare routes on one decision record</strong><p>Rank ocean versus air and gateway options by cost, lead time, risk, and confidence.</p></div>
              <div><span className={styles.mobileMatrixLabel}>Data gate</span><span className={styles.gateNeeded}>Rates, schedules, milestones, exceptions, compliance</span></div>
            </div>
            <div className={styles.matrixRow}>
              <div><span className={styles.mobileMatrixLabel}>Priority</span><span className={styles.priorityLater}>Later</span></div>
              <div><span className={styles.mobileMatrixLabel}>Workflow hypothesis</span><strong>Lead discovery is incomplete</strong><p>Public previews are examples, not a searchable buyer population.</p></div>
              <div><span className={styles.mobileMatrixLabel}>System action</span><strong>Score only after entity resolution</strong><p>Resolve aliases, verify the importer role, then rank fit and draft outreach for approval.</p></div>
              <div><span className={styles.mobileMatrixLabel}>Data gate</span><span className={styles.gateNeeded}>Licensed BOL feed</span></div>
            </div>
          </div>
        </section>
        </details>

        <section className={styles.section} id="sources">
          <div className={styles.sectionHeading}>
            <div className={styles.sectionNumber}>06</div>
            <div>
              <p className={styles.sectionEyebrow}>Evidence ledger</p>
              <h2>Sources and provider state</h2>
            </div>
          </div>

          <div className={styles.providerGrid}>
            <div className={styles.providerCard}>
              <div className={styles.providerTop}>
                <strong>U.S. Census</strong>
                <span className={fullyLoaded ? styles.providerLive : dataState === "partial" ? styles.providerReady : styles.providerOff}>
                  {dataState === "complete"
                    ? "Loaded"
                    : dataState === "partial"
                      ? "Partial"
                      : "Unavailable"}
                </span>
              </div>
              <p>Official aggregate value and weight by mode. No company identities or shipment records.</p>
              <span>
                {dataState === "complete"
                  ? `${census.sourceFileCount} import ZIPs plus country dictionary loaded`
                  : dataState === "partial"
                    ? "One current source file is missing"
                    : "Rebuild the public-file snapshot"}
              </span>
            </div>
            <div className={styles.providerCard}>
              <div className={styles.providerTop}><strong>Public BOL previews</strong><span className={styles.providerManual}>Manual</span></div>
              <p>{companyEvidence.length} ImportGenius pages checked. ImportYeti is unavailable for Derya commercial use without explicit permission or a license.</p>
              <span>No account, export, API, or live integration</span>
            </div>
            <div className={styles.providerCard}>
              <div className={styles.providerTop}><strong>TradeAtlas / Trademo</strong><span className={styles.providerOff}>Not connected</span></div>
              <p>Potential commercial sources. They are not used as if live in this report.</p>
              <span>Evaluate coverage before purchase</span>
            </div>
            <div className={styles.providerCard}>
              <div className={styles.providerTop}><strong>Company-level air</strong><span className={styles.providerOff}>Gap</span></div>
              <p>Public U.S. air-waybill history is not available like ocean manifest data.</p>
              <span>Requires a different licensed source</span>
            </div>
          </div>

          <details className={styles.evidenceDetails}>
            <summary>
              <span className={styles.evidenceSummaryCopy}>
                <strong>Exact claim evidence</strong>
                <span>{resolvedSources.length} cited files and observations</span>
              </span>
              <span className={styles.evidenceSummaryStatus}>Numbered sources</span>
            </summary>
            <ol className={styles.sourceLedger}>
              {resolvedSources.map(({ number, use, definition }) => {
                const observedCompanyName = companyBySourceKey.get(sourceKey(use));
                const state = use.fetchedAt ? "Fetched" : observedCompanyName ? "Manual observation" : "Reference reviewed";
                const displayName = observedCompanyName
                  ? `${observedCompanyName} public importer preview`
                  : use.displayName ?? definition.name;
                return (
                  <li id={`source-s${number}`} key={sourceKey(use)}>
                    <div className={styles.sourceNumber}>S{number}</div>
                    <div className={styles.sourceBody}>
                      <div className={styles.sourceTitleRow}>
                        <strong>{displayName}</strong>
                        <span>{state}</span>
                      </div>
                      <p>{definition.publisher}</p>
                      <div className={styles.sourceMeta}>
                        <span>
                          {use.fetchedAt
                            ? `Data as of ${use.asOf ?? "not published"}`
                            : observedCompanyName
                              ? `Record as of ${use.asOf ?? "not stated"}`
                              : "Method or terms reference"}
                        </span>
                        <span>{use.fetchedAt ? `Fetched ${use.fetchedAt.slice(0, 10)}` : `Reviewed ${use.reviewedAt?.slice(0, 10) ?? "date unavailable"}`}</span>
                        {use.integritySha256 && <span>SHA-256 {use.integritySha256.slice(0, 12)}</span>}
                      </div>
                    </div>
                    <a href={use.sourceUrl} target="_blank" rel="noreferrer" className={styles.openSource}>
                      Open source <Icon name="external" size={13} />
                    </a>
                  </li>
                );
              })}
            </ol>
          </details>

          <details className={`${styles.evidenceDetails} ${styles.referenceSection}`}>
            <summary>
              <span className={styles.evidenceSummaryCopy}>
                <strong>Provider references evaluated</strong>
                <span>{resolvedProviderReferences.length} method, terms, and vendor pages</span>
              </span>
              <span className={styles.evidenceSummaryStatus}>Reference only</span>
            </summary>
            <ul className={styles.referenceLedger}>
              {resolvedProviderReferences.map(({ use, definition }) => (
                <li key={sourceKey(use)}>
                  <div>
                    <strong>{use.displayName ?? definition.name}</strong>
                    <span>{definition.publisher}</span>
                  </div>
                  <span>{definition.cadence}</span>
                  <a href={use.sourceUrl} target="_blank" rel="noreferrer">
                    Open reference <Icon name="external" size={13} />
                  </a>
                </li>
              ))}
            </ul>
          </details>

          <details className={styles.methodDetails}>
            <summary>Methodology, limits, and next data unlock</summary>
            <div className={styles.methodBody}>
              <div>
                <h4>Official aggregate method</h4>
                <p>
                  Census vessel, containerized vessel, and air values come from keyless public download files. California
                  uses State Imports HS6. West Coast throughput uses Port Imports HS6 ports of unlading within districts {WEST_COAST_GATEWAY_DISTRICTS.map((item) => item.code).join(", ")}.
                  December YTD files represent revised annual totals. Current YTD fields are not summed across months.
                </p>
              </div>
              <div>
                <h4>Company evidence method</h4>
                <p>
                  Public provider pages were manually reviewed on {companyEvidenceReviewedDate}. No scraping, automated retrieval, or paid
                  provider access was used. Company rows are observations, not a census or a lead score.
                </p>
              </div>
              <div>
                <h4>Next unlock</h4>
                <p>
                  Refresh the keyless Census snapshot after each monthly release. Only buy a bill-of-lading provider after
                  a sample export passes importer identity, port, product, and historical coverage checks.
                </p>
              </div>
            </div>
          </details>

          <footer className={styles.reportFooter}>
            <span>Derya Intel</span>
            <span>Data through {formatMonth(census.asOfMonth)}</span>
            <span>Snapshot built {formatTimestamp(census.generatedAt)}</span>
            <span>Latest source HTTP timestamp {formatTimestamp(census.latestSourceModifiedAt)}</span>
            <span>{census.sourceFileCount} official import ZIPs</span>
          </footer>
        </section>
      </div>
    </article>
  );
}

export function OceanHardwareReportSkeleton() {
  return (
    <div className={styles.skeletonShell} aria-label="Loading hardware import report">
      <div className={styles.skeletonHero}>
        <div className={styles.skeletonLineShort} />
        <div className={styles.skeletonTitle} />
        <div className={styles.skeletonLine} />
        <div className={styles.skeletonRail} />
      </div>
      <div className={styles.skeletonPaper}>
        <div className={styles.skeletonSectionTitle} />
        <div className={styles.skeletonGrid}>
          <div />
          <div />
        </div>
      </div>
    </div>
  );
}

export function OceanHardwareReportUnavailable() {
  return (
    <article className={styles.reportShell} aria-labelledby="hardware-report-unavailable-title" data-intel-report>
      <header className={styles.reportHero}>
        <div className={styles.heroGrid} aria-hidden="true" />
        <div className={styles.heroTopline}>
          <div className={styles.reportKicker}>
            <span>Research report 01</span>
            <span className={styles.kickerDivider} />
            <span>Data integrity stop</span>
          </div>
          <div className={styles.statusPartial}>
            <span className={styles.statusDot} />
            Official snapshot unavailable
          </div>
        </div>
        <div className={styles.heroCopy}>
          <p className={styles.heroOverline}>California destination volume + West Coast ports</p>
          <h1 id="hardware-report-unavailable-title">Hardware import intelligence</h1>
          <p className={styles.heroSummary}>
            The committed Census snapshot failed validation. No aggregate value is being shown as zero or reused without
            evidence.
          </p>
        </div>
      </header>
      <div className={styles.reportPaper}>
        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <div className={styles.sectionNumber}>!</div>
            <div>
              <p className={styles.sectionEyebrow}>Publication blocked</p>
              <h2>Rebuild and review the official snapshot</h2>
            </div>
          </div>
          <div className={styles.dataBlockedLead}>
            <div><Icon name="shield" size={22} /></div>
            <div>
              <span>Fail-closed data boundary</span>
              <h3>The report cannot certify its source artifact</h3>
              <p>
                Run the reviewed Census snapshot build, inspect the artifact diff, and rerun the Intel verification suite
                before publishing totals or downloading data.
              </p>
            </div>
          </div>
        </section>
      </div>
    </article>
  );
}
