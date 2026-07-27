import type { ReactNode } from "react";
import { selectCorridorWatchPrimaryGateway } from "@/lib/intel";
import type {
  CensusPublicOriginCorridorWatch,
  ChinaCustomsDecisionGuide,
  CorridorWatchCategorySignal,
  CorridorWatchEvidenceRequirement,
  CorridorWatchScopeSignal,
  CorridorWatchVesselMetrics,
  OceanHardwareRoutingResearchBrief,
} from "@/lib/intel";
import { ChinaCustomsDecisionGuideSection } from "./china-customs-decision-guide";
import styles from "./china-corridor-watch.module.css";

type ChinaCorridorWatchProps = {
  watch: CensusPublicOriginCorridorWatch;
  brief: OceanHardwareRoutingResearchBrief;
  customsGuide: ChinaCustomsDecisionGuide;
  sourceIndex: ReadonlyMap<string, number>;
  evidence?: ReactNode;
};

const EVIDENCE_LABELS: Record<
  CorridorWatchEvidenceRequirement["id"],
  string
> = {
  foreign_origin_port: "Foreign loading port",
  actual_us_discharge_port: "Exact U.S. discharge port",
  shipment_endpoints: "Pickup and delivery endpoints",
  shipment_route: "Shipment-level route records",
  carrier_service: "Carrier and service string",
  sailing_schedule: "Current sailing schedule",
  transit_reliability: "Transit reliability",
  freight_rate: "Freight rate and accessorials",
  cargo_handling: "Cargo handling requirements",
  company_shipment: "Licensed company shipment evidence",
};

const POSTURE_LABELS: Record<
  CorridorWatchCategorySignal["researchPosture"],
  string
> = {
  primary_gateway_concentration: "Concentrated primary district",
  dual_gateway_comparison: "Two-district comparison",
  distributed_observation: "Distributed district research",
};

const COMMERCIAL_CUE_LABELS: Record<
  CorridorWatchCategorySignal["commercialCues"][number],
  string
> = {
  high_aggregate_weight_low_unit_value:
    "High aggregate weight, low unit value",
  high_unit_value: "High unit value",
};

const RESEARCH_QUEUE: Array<{
  step: string;
  title: string;
  evidenceIds: CorridorWatchEvidenceRequirement["id"][];
  outcome: string;
}> = [
  {
    step: "01",
    title: "Define the shipment",
    evidenceIds: ["shipment_endpoints", "cargo_handling"],
    outcome:
      "Fix the pickup, delivery, commodity, dimensions, equipment, and handling constraints.",
  },
  {
    step: "02",
    title: "Resolve the port pair",
    evidenceIds: ["foreign_origin_port", "actual_us_discharge_port"],
    outcome:
      "Replace country and district aggregates with an actual Chinese loading port and U.S. discharge port.",
  },
  {
    step: "03",
    title: "Test feasible services",
    evidenceIds: ["shipment_route", "carrier_service", "sailing_schedule"],
    outcome:
      "Compare current service strings, frequency, cutoff rules, and transshipment exposure.",
  },
  {
    step: "04",
    title: "Price and stress-test",
    evidenceIds: ["transit_reliability", "freight_rate"],
    outcome:
      "Evaluate rates, accessorials, transit variance, rollover history, and delay exposure.",
  },
  {
    step: "05",
    title: "Qualify commercial demand",
    evidenceIds: ["company_shipment"],
    outcome:
      "Use licensed shipment evidence before making any importer or lead claim.",
  },
];

function compactUsd(value: number | null): string {
  if (value == null) return "Unavailable";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: value >= 1_000_000_000 ? 2 : 1,
  }).format(value);
}

function formatShareBps(value: number | null): string {
  if (value == null) return "Unavailable";
  const percent = value / 100;
  return `${percent.toFixed(percent < 10 ? 2 : 1)}%`;
}

function formatUnitValue(value: number | null): string {
  if (value == null) return "Unavailable";
  return `${new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value)} per kg observed value`;
}

function percentChange(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function formatSignedPercent(value: number | null): string {
  if (value == null) return "Unavailable";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatSignedPoints(value: number | null): string {
  if (value == null) return "Unavailable";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} pts`;
}

function formatMonth(value: string): string {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function sourceKey(source: CensusPublicOriginCorridorWatch["sources"][number]): string {
  return `${source.sourceId}|${source.sourceUrl}`;
}

function metricValue(signal: CorridorWatchScopeSignal): number | null {
  return signal.status === "observed" && signal.metrics
    ? signal.metrics.vesselValueUsd
    : null;
}

type ExposureHistoryPoint = {
  year: number;
  californiaDestination: CorridorWatchScopeSignal;
  westCoastGateways: CorridorWatchScopeSignal;
};

function HistoryLineChart({
  id,
  title,
  description,
  points,
  metric,
}: {
  id: string;
  title: string;
  description: string;
  points: readonly ExposureHistoryPoint[];
  metric: "vessel_value" | "origin_share";
}) {
  const width = 720;
  const height = 250;
  const plot = {
    left: 74,
    right: 20,
    top: 22,
    bottom: 42,
  };
  const plotWidth = width - plot.left - plot.right;
  const plotHeight = height - plot.top - plot.bottom;
  const valueFor = (
    point: ExposureHistoryPoint,
    scope: "westCoastGateways" | "californiaDestination"
  ) =>
    metric === "vessel_value"
      ? metricValue(point[scope]) ?? 0
      : point[scope].originShareBps ?? 0;
  const westCoastValues = points.map((point) =>
    valueFor(point, "westCoastGateways")
  );
  const californiaValues = points.map((point) =>
    valueFor(point, "californiaDestination")
  );
  const maxValue = Math.max(1, ...westCoastValues, ...californiaValues);
  const xFor = (index: number) =>
    plot.left +
    (points.length <= 1 ? 0 : (index / (points.length - 1)) * plotWidth);
  const yFor = (value: number) =>
    plot.top + plotHeight - (value / maxValue) * plotHeight;
  const pathFor = (values: readonly number[]) =>
    values
      .map(
        (value, index) =>
          `${index === 0 ? "M" : "L"} ${xFor(index).toFixed(2)} ${yFor(
            value
          ).toFixed(2)}`
      )
      .join(" ");
  const axisLabel = (value: number) =>
    metric === "vessel_value" ? compactUsd(value) : formatShareBps(value);
  const firstPoint = points.at(0);
  const lastPoint = points.at(-1);
  const accessibleDescription =
    firstPoint && lastPoint
      ? `${description} Solid West Coast districts series: ${axisLabel(
          valueFor(firstPoint, "westCoastGateways")
        )} in ${firstPoint.year} and ${axisLabel(
          valueFor(lastPoint, "westCoastGateways")
        )} in ${lastPoint.year}. Dashed California destination series: ${axisLabel(
          valueFor(firstPoint, "californiaDestination")
        )} in ${firstPoint.year} and ${axisLabel(
          valueFor(lastPoint, "californiaDestination")
        )} in ${lastPoint.year}. Exact annual values and official source links follow in the annual-values table.`
      : description;
  const highlightYears = new Set([
    points.at(0)?.year,
    2018,
    2020,
    points.at(-1)?.year,
  ]);
  const highlightedPoints = points
    .map((point, index) => ({ point, index }))
    .filter(({ point }) => highlightYears.has(point.year));
  const yTicks = [maxValue, maxValue / 2, 0];

  return (
    <figure className={styles.historyChart}>
      <figcaption>
        <strong>{title}</strong>
        <span>{description}</span>
      </figcaption>
      <div className={styles.historyChartLegend}>
        <span>
          <i data-series="west-coast" />
          West Coast districts
        </span>
        <span>
          <i data-series="california" />
          California destination
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={`${id}-title ${id}-description`}
      >
        <title id={`${id}-title`}>{title}</title>
        <desc id={`${id}-description`}>{accessibleDescription}</desc>
        {yTicks.map((tick) => (
          <g key={tick} className={styles.historyChartGrid}>
            <line
              x1={plot.left}
              x2={width - plot.right}
              y1={yFor(tick)}
              y2={yFor(tick)}
            />
            <text x={plot.left - 10} y={yFor(tick) + 4}>
              {axisLabel(tick)}
            </text>
          </g>
        ))}
        <path
          className={styles.historyLineWestCoast}
          d={pathFor(westCoastValues)}
        />
        <path
          className={styles.historyLineCalifornia}
          d={pathFor(californiaValues)}
        />
        {highlightedPoints.map(({ point, index }) => (
          <g key={point.year}>
            <circle
              className={styles.historyMarkerWestCoast}
              cx={xFor(index)}
              cy={yFor(westCoastValues[index])}
              r="4"
            />
            <circle
              className={styles.historyMarkerCalifornia}
              cx={xFor(index)}
              cy={yFor(californiaValues[index])}
              r="4"
            />
            <text
              className={styles.historyChartYear}
              x={xFor(index)}
              y={height - 14}
            >
              {point.year}
            </text>
          </g>
        ))}
      </svg>
    </figure>
  );
}

function containerizedShare(metrics: CorridorWatchVesselMetrics): string {
  return formatShareBps(metrics.containerizedShareBps);
}

function GatewayRows({
  signals,
  rankOffset = 0,
}: {
  signals: CensusPublicOriginCorridorWatch["currentGatewaySignals"];
  rankOffset?: number;
}) {
  return (
    <>
      {signals.map((signal, index) => (
        <tr key={signal.gatewayDistrictCode}>
          <td className={styles.rank}>{rankOffset + index + 1}</td>
          <th scope="row">
            <strong>District {signal.gatewayDistrictCode}</strong>
            <span>{signal.gatewayDistrictLabel}</span>
          </th>
          <td>{compactUsd(signal.metrics.vesselValueUsd)}</td>
          <td>{formatShareBps(signal.originShareBps)}</td>
          <td>{containerizedShare(signal.metrics)}</td>
        </tr>
      ))}
    </>
  );
}

function GatewayTable({
  signals,
  rankOffset = 0,
  label,
}: {
  signals: CensusPublicOriginCorridorWatch["currentGatewaySignals"];
  rankOffset?: number;
  label: string;
}) {
  return (
    <div
      className={styles.tableScroll}
      tabIndex={0}
      role="region"
      aria-label={`Scrollable ${label}`}
    >
      <table className={styles.gatewayTable}>
        <caption>{label}</caption>
        <thead>
          <tr>
          <th scope="col">Rank</th>
          <th scope="col">Port-of-unlading district</th>
          <th scope="col">Vessel value</th>
          <th scope="col">Share of China-origin West Coast value</th>
          <th scope="col">Containerized share of vessel value</th>
          </tr>
        </thead>
        <tbody>
          <GatewayRows signals={signals} rankOffset={rankOffset} />
        </tbody>
      </table>
    </div>
  );
}

function CategoryResearchRow({
  signal,
  index,
}: {
  signal: CorridorWatchCategorySignal;
  index: number;
}) {
  return (
    <article className={styles.categoryRow}>
      <div className={styles.categoryIdentity}>
        <span className={styles.rowIndex}>{String(index + 1).padStart(2, "0")}</span>
        <div>
          <h4>{signal.categoryLabel}</h4>
          <p>
            {compactUsd(signal.metrics.vesselValueUsd)} observed vessel value
            <span aria-hidden="true"> · </span>
            {formatShareBps(signal.originShareBps)} of China exposure
          </p>
        </div>
      </div>
      <div className={styles.categoryGateway}>
        <span>Observed primary</span>
        <strong>
          District {signal.observedPrimaryGateway.gatewayDistrictCode},{" "}
          {signal.observedPrimaryGateway.gatewayDistrictLabel}
        </strong>
        <small>
          {formatShareBps(signal.observedPrimaryGateway.categoryShareBps)} of
          this category
        </small>
      </div>
      <div className={styles.categoryComparison}>
        <span>Threshold-qualified comparison</span>
        {signal.comparisonGateways.length > 0 ? (
          <ul>
            {signal.comparisonGateways.map((gateway) => (
              <li key={gateway.gatewayDistrictCode}>
                <strong>
                  District {gateway.gatewayDistrictCode},{" "}
                  {gateway.gatewayDistrictLabel}
                </strong>
                <small>{formatShareBps(gateway.categoryShareBps)}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p>None meets both the 10% share and $50M value thresholds.</p>
        )}
      </div>
      <div className={styles.categoryPosture}>
        <span>Research posture</span>
        <strong>{POSTURE_LABELS[signal.researchPosture]}</strong>
        <small>{formatUnitValue(signal.unitValueUsdPerKg)}</small>
        {signal.commercialCues.length > 0 ? (
          <ul className={styles.commercialCues}>
            {signal.commercialCues.map((cue) => (
              <li key={cue}>{COMMERCIAL_CUE_LABELS[cue]}</li>
            ))}
          </ul>
        ) : (
          <small>No aggregate commercial cue triggered</small>
        )}
      </div>
    </article>
  );
}

export function ChinaCorridorWatch({
  watch,
  brief,
  customsGuide,
  sourceIndex,
  evidence,
}: ChinaCorridorWatchProps) {
  const primaryGateway = selectCorridorWatchPrimaryGateway(
    watch.currentGatewaySignals
  );
  const topGatewaySignals = watch.currentGatewaySignals.slice(0, 3);
  const smallerGatewaySignals = watch.currentGatewaySignals.slice(3);
  const fallbackComparableHistory = watch.completeYearOriginHistory.filter(
    (period) => period.basketComparable
  );
  const fixedBasketHistory = watch.fixedBasketOriginHistory;
  const displayedHistory =
    fixedBasketHistory?.completeYears ?? fallbackComparableHistory;
  const displayedHistoryStart = displayedHistory.at(0)?.year;
  const displayedHistoryEnd = displayedHistory.at(-1)?.year;
  const latestCompleteYear = displayedHistory.at(-1);
  const priorCompleteYear = displayedHistory.at(-2);
  const baselineCompleteYear = displayedHistory.at(0);
  const latestCompleteWestCoastValue = latestCompleteYear
    ? metricValue(latestCompleteYear.westCoastGateways)
    : null;
  const priorCompleteWestCoastValue = priorCompleteYear
    ? metricValue(priorCompleteYear.westCoastGateways)
    : null;
  const completeYearValueChange = percentChange(
    latestCompleteWestCoastValue,
    priorCompleteWestCoastValue
  );
  const completeYearShareChange =
    latestCompleteYear?.westCoastGateways.originShareBps != null &&
    priorCompleteYear?.westCoastGateways.originShareBps != null
      ? (latestCompleteYear.westCoastGateways.originShareBps -
          priorCompleteYear.westCoastGateways.originShareBps) /
        100
      : null;
  const baselineCompleteWestCoastValue = baselineCompleteYear
    ? metricValue(baselineCompleteYear.westCoastGateways)
    : null;
  const longRunValueChange = percentChange(
    latestCompleteWestCoastValue,
    baselineCompleteWestCoastValue
  );
  const longRunShareChange =
    latestCompleteYear?.westCoastGateways.originShareBps != null &&
    baselineCompleteYear?.westCoastGateways.originShareBps != null
      ? (latestCompleteYear.westCoastGateways.originShareBps -
          baselineCompleteYear.westCoastGateways.originShareBps) /
        100
      : null;
  const currentWestCoast = watch.currentYtd.westCoastGateways;
  const currentCalifornia = watch.currentYtd.californiaDestination;
  const evidenceById = new Map(
    brief.requiredEvidence.map((item) => [item.id, item])
  );

  return (
    <section className={styles.watch} id="china-watch" aria-labelledby="china-watch-title">
      <div className={styles.decisionWorkspace}>
        <header className={styles.watchHeader}>
          <div className={styles.headerCopy}>
            <div className={styles.eyebrow}>
              <span>China to U.S. West Coast</span>
              <span>{formatMonth(watch.asOfMonth)} Census observation</span>
            </div>
            <h2 id="china-watch-title">{brief.title}</h2>
            <p className={styles.decisionLead}>
              {primaryGateway
                ? `District ${primaryGateway.gatewayDistrictCode} is the observed research starting point, not a route recommendation.`
                : "No current gateway observation is available for route research."}
            </p>
            <p className={styles.decisionContext}>
              {primaryGateway
                ? `${compactUsd(
                    primaryGateway.metrics.vesselValueUsd
                  )} was observed at the ${primaryGateway.gatewayDistrictLabel} port-of-unlading district, ${formatShareBps(
                    primaryGateway.originShareBps
                  )} of China-origin West Coast hardware vessel value.`
                : "The current aggregate does not contain a positive gateway observation."}{" "}
              This district-level signal does not identify a Chinese loading
              port, terminal, carrier service, transit time, rate, or shipment
              endpoint.
            </p>
            {evidence ? (
              <div className={styles.primaryEvidence}>
                <span>Evidence for this observation</span>
                {evidence}
              </div>
            ) : null}
          </div>
          <div className={styles.decisionState}>
            <span>Decision state</span>
            <strong>Research only</strong>
            <p>
              Aggregate evidence is useful for prioritizing checks. It is not
              sufficient to select or quote a route.
            </p>
          </div>
        </header>

        <dl className={styles.factRail}>
          <div>
            <dt>China West Coast value</dt>
            <dd>{compactUsd(metricValue(currentWestCoast))}</dd>
            <small>Current YTD vessel value</small>
          </div>
          <div>
            <dt>Share of West Coast basket</dt>
            <dd>{formatShareBps(currentWestCoast.originShareBps)}</dd>
            <small>China origin, vessel value</small>
          </div>
          <div>
            <dt>Top two districts</dt>
            <dd>{formatShareBps(watch.topTwoGatewayShareBps)}</dd>
            <small>Share of China-origin value</small>
          </div>
          <div>
            <dt>California destination value</dt>
            <dd>{compactUsd(metricValue(currentCalifornia))}</dd>
            <small>Independent ultimate-destination basis</small>
          </div>
        </dl>

        <div className={styles.readinessRail} aria-label="Research readiness">
          <div>
            <span>Aggregate history</span>
            <strong data-status="available">
              {watch.dataAvailability.aggregateOriginHistory === "observed"
                ? "Observed"
                : "Unavailable"}
            </strong>
          </div>
          <div>
            <span>Category by district</span>
            <strong data-status="available">
              {watch.currentCategoryGatewaySegmentCount} signals
            </strong>
          </div>
          <div>
            <span>Port-to-port route</span>
            <strong data-status="blocked">Unavailable</strong>
          </div>
          <div>
            <span>Route readiness</span>
            <strong data-status="blocked">Research only</strong>
          </div>
        </div>

        <nav className={styles.actionRail} aria-label="China watch actions">
          <a href="#customs-guide">Review customs gates</a>
          <a href="#china-gateways">Compare gateways</a>
          <a href="#routing-brief">Review routing inputs</a>
          <a href="/api/intel/hardware-imports/china-watch" download>
            Download watch JSON
          </a>
          <a href="#sources">View evidence</a>
        </nav>
      </div>

      <section className={styles.reportSection} id="china-gateways" aria-labelledby="china-gateways-title">
        <header className={styles.sectionHeader}>
          <div>
            <span className={styles.sectionNumber}>01</span>
            <p>Observed U.S. arrival geography</p>
            <h3 id="china-gateways-title">Ranked China gateway districts</h3>
          </div>
          <p className={styles.sectionNote}>
            Port-of-unlading districts group ports. They are not terminals,
            routes, or destination markets.
          </p>
        </header>

        <GatewayTable
          signals={topGatewaySignals}
          label="Top China-origin West Coast hardware port-of-unlading districts"
        />
        <p className={styles.districtCaveat}>
          District labels group multiple ports. District 27, for example,
          includes Los Angeles, Long Beach, Hueneme, and other district ports.
          The aggregate cannot identify which port or terminal handled a
          shipment.
        </p>
        {smallerGatewaySignals.length > 0 ? (
          <details className={styles.moreGateways}>
            <summary>
              <span>
                Show {smallerGatewaySignals.length} smaller observed district
                {smallerGatewaySignals.length === 1 ? "" : "s"}
              </span>
              <small>Same current YTD basis</small>
            </summary>
            <GatewayTable
              signals={smallerGatewaySignals}
              rankOffset={topGatewaySignals.length}
              label="Smaller China-origin West Coast hardware port-of-unlading districts"
            />
          </details>
        ) : null}
      </section>

      <section
        className={styles.reportSection}
        id="china-history"
        aria-labelledby="china-exposure-title"
      >
        <header className={styles.sectionHeader}>
          <div>
            <span className={styles.sectionNumber}>02</span>
            <p>Fixed-basket customs history</p>
            <h3 id="china-exposure-title">
              China exposure, 2010 to present
            </h3>
          </div>
          <p className={styles.sectionNote}>
            {displayedHistoryStart != null && displayedHistoryEnd != null
              ? fixedBasketHistory
                ? `Complete years ${displayedHistoryStart} to ${displayedHistoryEnd} use one fixed ${fixedBasketHistory.applicableHsCodeCount}-code hardware basket.`
                : `Complete years ${displayedHistoryStart} to ${displayedHistoryEnd} use the comparable current hardware basket.`
              : "No comparable complete-year history is available."}{" "}
            Values are nominal and current YTD is deliberately separated.
          </p>
        </header>

        <div className={styles.historyLayout}>
          <div className={styles.historyCharts}>
            <HistoryLineChart
              id="china-history-value"
              title="Nominal vessel value"
              description={`Annual China-origin customs value for the fixed hardware basket across West Coast port-of-unlading districts and California ultimate destination, ${displayedHistoryStart} through ${displayedHistoryEnd}.`}
              points={displayedHistory}
              metric="vessel_value"
            />
            <HistoryLineChart
              id="china-history-share"
              title="China share of each hardware basket"
              description={`Annual China-origin share of fixed-basket vessel value for West Coast port-of-unlading districts and California ultimate destination, ${displayedHistoryStart} through ${displayedHistoryEnd}.`}
              points={displayedHistory}
              metric="origin_share"
            />
          </div>
          <aside className={styles.currentPeriod}>
            <span>
              Long-run change, {baselineCompleteYear?.year} to{" "}
              {latestCompleteYear?.year}
            </span>
            <strong>{formatSignedPercent(longRunValueChange)}</strong>
            <p>
              China-origin West Coast vessel value in the{" "}
              {fixedBasketHistory
                ? `fixed ${fixedBasketHistory.applicableHsCodeCount}-code hardware basket`
                : "comparable hardware basket"}
              .
            </p>
            <dl>
              <div>
                <dt>{baselineCompleteYear?.year} West Coast value</dt>
                <dd>{compactUsd(baselineCompleteWestCoastValue)}</dd>
              </div>
              <div>
                <dt>{latestCompleteYear?.year} West Coast value</dt>
                <dd>{compactUsd(latestCompleteWestCoastValue)}</dd>
              </div>
              <div>
                <dt>China share change</dt>
                <dd>{formatSignedPoints(longRunShareChange)}</dd>
              </div>
            </dl>
            <div className={styles.completedYearSignal}>
              <span>
                {latestCompleteYear?.year} vs {priorCompleteYear?.year}
              </span>
              <strong>{formatSignedPercent(completeYearValueChange)}</strong>
              <p>
                China-origin West Coast hardware vessel value. Basket share
                changed {formatSignedPoints(completeYearShareChange)}.
              </p>
              <small>
                This is an observed composition change, not an explanation of
                its cause.
              </small>
            </div>
            <div className={styles.currentYtdSignal}>
              <span>Current YTD, through {formatMonth(watch.asOfMonth)}</span>
              <strong>{compactUsd(metricValue(currentWestCoast))}</strong>
              <p>
                Current 46-code basket, separate from the fixed 43-code
                history. West Coast share is{" "}
                {formatShareBps(currentWestCoast.originShareBps)} and
                California destination value is{" "}
                {compactUsd(metricValue(currentCalifornia))}.
              </p>
              <small>
                Partial-year values must not be compared directly with
                complete years.
              </small>
            </div>
            <small>
              {fixedBasketHistory
                ? "The long-run series excludes three HS groups introduced in 2022 and is not adjusted for inflation."
                : "The complete-year series is not adjusted for inflation."}
            </small>
          </aside>
        </div>

        <details className={styles.historyDataDetails}>
          <summary>
            <span>
              Open exact annual values and official files
              <small>Complete years only, latest first</small>
            </span>
            <strong>{displayedHistory.length} years</strong>
          </summary>
          <div
            className={styles.tableScroll}
            tabIndex={0}
            role="region"
            aria-label="Scrollable exact China exposure history table"
          >
            <table className={styles.historyTable}>
              <caption>
                China hardware exposure for fixed-basket complete years
              </caption>
              <thead>
                <tr>
                  <th scope="col">Complete year</th>
                  <th scope="col">West Coast port-of-unlading districts</th>
                  <th scope="col">California ultimate destination</th>
                </tr>
              </thead>
              <tbody>
                {[...displayedHistory].reverse().map((period) => {
                  const periodSources = watch.sources.filter(
                    (source) =>
                      source.sourceId === "census_trade_downloads" &&
                      source.asOf === period.period
                  );
                  const westCoastSource = periodSources.find((source) =>
                    source.displayName?.startsWith("Port Imports HS6")
                  );
                  const californiaSource = periodSources.find((source) =>
                    source.displayName?.startsWith("State Imports HS6")
                  );
                  const westCoastSourceIndex = westCoastSource
                    ? sourceIndex.get(sourceKey(westCoastSource))
                    : undefined;
                  const californiaSourceIndex = californiaSource
                    ? sourceIndex.get(sourceKey(californiaSource))
                    : undefined;

                  return (
                    <tr key={period.year}>
                      <th scope="row">{period.year}</th>
                      <td data-label="West Coast port districts">
                        <span className={styles.historyMetric}>
                          <strong>
                            {compactUsd(
                              metricValue(period.westCoastGateways)
                            )}
                          </strong>
                          <span>
                            {formatShareBps(
                              period.westCoastGateways.originShareBps
                            )}{" "}
                            China share
                          </span>
                        </span>
                        {westCoastSourceIndex ? (
                          <span className={styles.historyEvidence}>
                            <a
                              href={`#source-s${westCoastSourceIndex}`}
                              aria-label={`Open West Coast Port Imports source S${westCoastSourceIndex} for ${period.year}`}
                            >
                              WC S{westCoastSourceIndex}
                            </a>
                          </span>
                        ) : null}
                      </td>
                      <td data-label="California ultimate destination">
                        <span className={styles.historyMetric}>
                          <strong>
                            {compactUsd(
                              metricValue(period.californiaDestination)
                            )}
                          </strong>
                          <span>
                            {formatShareBps(
                              period.californiaDestination.originShareBps
                            )}{" "}
                            China share
                          </span>
                        </span>
                        {californiaSourceIndex ? (
                          <span className={styles.historyEvidence}>
                            <a
                              href={`#source-s${californiaSourceIndex}`}
                              aria-label={`Open California State Imports source S${californiaSourceIndex} for ${period.year}`}
                            >
                              CA S{californiaSourceIndex}
                            </a>
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section className={styles.reportSection} aria-labelledby="china-category-title">
        <header className={styles.sectionHeader}>
          <div>
            <span className={styles.sectionNumber}>03</span>
            <p>Current category exposure</p>
            <h3 id="china-category-title">
              {watch.currentCategorySignals.length} category routing research{" "}
              {watch.currentCategorySignals.length === 1 ? "brief" : "briefs"}
            </h3>
          </div>
          <p className={styles.sectionNote}>
            Comparison districts appear only when they represent at least 10%
            of category value and at least $50M in observed vessel value.
          </p>
        </header>

        <div className={styles.categoryList}>
          {watch.currentCategorySignals.map((signal, index) => (
            <CategoryResearchRow
              key={signal.category}
              signal={signal}
              index={index}
            />
          ))}
        </div>
      </section>

      <ChinaCustomsDecisionGuideSection
        guide={customsGuide}
        sourceIndex={sourceIndex}
      />

      <section
        className={`${styles.reportSection} ${styles.routingSection}`}
        id="routing-brief"
        aria-labelledby="routing-brief-title"
      >
        <header className={styles.routingHeader}>
          <div>
            <span className={styles.sectionNumber}>05</span>
            <p>Decision gate</p>
            <h3 id="routing-brief-title">What is required before routing</h3>
          </div>
          <div className={styles.routingState}>
            <span>Route readiness</span>
            <strong>Research only</strong>
            <small>Partial evidence package</small>
          </div>
        </header>

        <p className={styles.routingLead}>
          No gateway district in this report is a recommended route. Every
          required shipment, service, reliability, and commercial input below
          is still unavailable.
        </p>

        <div className={styles.evidenceChecklist}>
          {brief.requiredEvidence.map((item) => (
            <div key={item.id}>
              <span aria-hidden="true">Missing</span>
              <strong>{EVIDENCE_LABELS[item.id]}</strong>
              <p>{item.reason}</p>
            </div>
          ))}
        </div>

        <div className={styles.queueHeader}>
          <div>
            <p>Prioritized research queue</p>
            <h4>Turn aggregate exposure into a route decision</h4>
          </div>
          <span>5 gates, in order</span>
        </div>
        <ol className={styles.researchQueue}>
          {RESEARCH_QUEUE.map((item) => (
            <li key={item.step}>
              <span>{item.step}</span>
              <div>
                <h5>{item.title}</h5>
                <p>{item.outcome}</p>
                <small>
                  Required:{" "}
                  {item.evidenceIds
                    .map((id) => EVIDENCE_LABELS[id])
                    .join(", ")}
                </small>
              </div>
              <strong>
                {item.evidenceIds.every(
                  (id) => evidenceById.get(id)?.status === "unavailable"
                )
                  ? "Blocked"
                  : "Review"}
              </strong>
            </li>
          ))}
        </ol>
      </section>
    </section>
  );
}
