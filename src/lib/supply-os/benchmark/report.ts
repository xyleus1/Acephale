import type {
  BenchmarkAggregateMetrics,
  BenchmarkRunConfiguration,
  BenchmarkSummaryDocument,
  BenchmarkSystemSummary,
} from "./result-types";

type Point = {
  label: string;
  value: number;
  secondary?: number;
  group?: string;
};

const SYSTEM_COLORS: Record<string, string> = {
  CURRENT_KEYWORD: "#64748b",
  VECTOR_RAG: "#8b5cf6",
  STRONG_HYBRID_RAG: "#0ea5e9",
  DERYA_COLD: "#f59e0b",
  DERYA_HOT: "#10b981",
};

function escapeHtml(value: unknown) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function format(value: number, digits = 3) {
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function measuredSystems(summary: BenchmarkSummaryDocument) {
  return summary.systems.filter((system): system is BenchmarkSystemSummary & {
    metrics: BenchmarkAggregateMetrics;
  } => system.status === "completed" && system.metrics !== null);
}

function graphConfiguration(configurations: BenchmarkRunConfiguration[]) {
  const unique = new Map<string, BenchmarkRunConfiguration>();
  for (const config of configurations) {
    const key = [
      config.profile,
      config.corpusSize,
      config.queryCount,
      config.topK,
      config.embeddingModel,
      config.runCount,
      config.hardwareLabel,
      config.postgresStatementTimeout,
      JSON.stringify(config.prismaPoolConfiguration),
      config.sourceTreeFingerprint,
      config.timestamp,
    ].join("|");
    unique.set(key, config);
  }
  if (!unique.size) return '<p class="config empty">No measured configuration.</p>';
  return [...unique.values()].sort((left, right) => left.corpusSize - right.corpusSize).map((config) => `
    <dl class="config">
      <div><dt>Profile</dt><dd>${escapeHtml(config.profile)}</dd></div>
      <div><dt>Corpus size</dt><dd>${format(config.corpusSize, 0)}</dd></div>
      <div><dt>Query count</dt><dd>${format(config.queryCount, 0)}</dd></div>
      <div><dt>Top-K</dt><dd>${format(config.topK, 0)}</dd></div>
      <div><dt>Embedding model</dt><dd>${escapeHtml(config.embeddingModel)}</dd></div>
      <div><dt>Run count</dt><dd>${format(config.runCount, 0)}</dd></div>
      <div><dt>Hardware</dt><dd>${escapeHtml(config.hardwareLabel)}</dd></div>
      <div><dt>PostgreSQL statement timeout</dt><dd>${escapeHtml(config.postgresStatementTimeout)}</dd></div>
      <div><dt>Prisma pool</dt><dd>${format(config.prismaPoolConfiguration.connectionLimit, 0)} connections / ${format(config.prismaPoolConfiguration.poolTimeoutSeconds, 0)}s wait</dd></div>
      <div><dt>Source tree SHA-256</dt><dd>${escapeHtml(config.sourceTreeFingerprint)}</dd></div>
      <div><dt>Source file count</dt><dd>${format(config.sourceTreeFileCount, 0)}</dd></div>
      <div><dt>Timestamp</dt><dd>${escapeHtml(config.timestamp)}</dd></div>
    </dl>`).join("");
}

function chartShell(input: {
  id: string;
  title: string;
  description: string;
  svg: string;
  configurations: BenchmarkRunConfiguration[];
}) {
  return `<section class="chart" id="${escapeHtml(input.id)}">
    <h2>${escapeHtml(input.title)}</h2>
    <p>${escapeHtml(input.description)}</p>
    ${input.svg}
    <h3>Measured configuration</h3>
    ${graphConfiguration(input.configurations)}
  </section>`;
}

function noData() {
  return '<div class="no-data">No measured values are available for this graph.</div>';
}

function barChart(points: Point[], options?: { percent?: boolean; unit?: string }) {
  if (!points.length) return noData();
  const width = 980;
  const rowHeight = 42;
  const height = Math.max(150, points.length * rowHeight + 58);
  const labelWidth = 245;
  const plotWidth = width - labelWidth - 125;
  const max = Math.max(...points.map((point) => point.value), 0.000_001);
  const rows = points.map((point, index) => {
    const y = 24 + index * rowHeight;
    const barWidth = Math.max(point.value === 0 ? 1 : 2, (point.value / max) * plotWidth);
    const color = SYSTEM_COLORS[point.group ?? ""] ?? "#2563eb";
    const display = options?.percent
      ? `${format(point.value * 100, 2)}%`
      : `${format(point.value, 3)}${options?.unit ?? ""}`;
    return `<g>
      <text x="0" y="${y + 16}" class="label">${escapeHtml(point.label)}</text>
      <rect x="${labelWidth}" y="${y}" width="${barWidth}" height="22" rx="4" fill="${color}"><title>${escapeHtml(point.label)}: ${escapeHtml(display)}</title></rect>
      <text x="${labelWidth + barWidth + 8}" y="${y + 16}" class="value">${escapeHtml(display)}</text>
    </g>`;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Bar chart">${rows}</svg>`;
}

function scatterChart(points: Point[]) {
  if (!points.length) return noData();
  const width = 980;
  const height = 460;
  const left = 80;
  const top = 25;
  const plotWidth = 830;
  const plotHeight = 350;
  const maxX = Math.max(...points.map((point) => point.value), 1);
  const dots = points.map((point) => {
    const x = left + (point.value / maxX) * plotWidth;
    const y = top + (1 - Math.max(0, Math.min(1, point.secondary ?? 0))) * plotHeight;
    const color = SYSTEM_COLORS[point.group ?? ""] ?? "#2563eb";
    return `<g>
      <circle cx="${x}" cy="${y}" r="7" fill="${color}"><title>${escapeHtml(point.label)}; p95 ${format(point.value, 2)} ms; Recall@20 ${format(point.secondary ?? 0, 4)}</title></circle>
      <text x="${x + 10}" y="${y - 8}" class="small-label">${escapeHtml(point.label)}</text>
    </g>`;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Recall versus p95 latency scatter plot">
    <line x1="${left}" y1="${top + plotHeight}" x2="${left + plotWidth}" y2="${top + plotHeight}" class="axis" />
    <line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotHeight}" class="axis" />
    <text x="${left + plotWidth / 2}" y="${height - 35}" class="axis-label">p95 latency (ms, lower is better)</text>
    <text x="18" y="${top + plotHeight / 2}" class="axis-label" transform="rotate(-90 18 ${top + plotHeight / 2})">Recall@20 (higher is better)</text>
    ${dots}
  </svg>`;
}

function groupedRateChart(points: Point[]) {
  if (!points.length) return noData();
  const expanded = points.flatMap((point) => [
    { label: `${point.label} stale escape`, value: point.value, group: point.group },
    { label: `${point.label} false conflict`, value: point.secondary ?? 0, group: point.group },
  ]);
  return barChart(expanded, { percent: true });
}

function graphConfigs(summary: BenchmarkSummaryDocument, systems: BenchmarkSystemSummary[]) {
  const keys = new Set(systems.map((system) => `${system.profile}:${system.systemName}`));
  return summary.configurations.filter((config) =>
    [...keys].some((key) => key.startsWith(`${config.profile}:`)));
}

function systemLabel(system: BenchmarkSystemSummary) {
  return `${system.profile} / ${system.systemName}`;
}

function reportGraphs(summary: BenchmarkSummaryDocument) {
  const measured = measuredSystems(summary);
  const recallBySystem = measured.map((system) => ({
    label: systemLabel(system),
    value: system.metrics.recallAt20,
    group: system.systemName,
  }));

  const recallByQueryType = measured.flatMap((system) => Object.entries(system.byQueryType)
    .filter(([, metrics]) => metrics.caseCount > 0)
    .map(([queryType, metrics]) => ({
      label: `${system.profile} / ${system.systemName} / ${queryType}`,
      value: metrics.recallAt20,
      group: system.systemName,
    })));

  const pareto = measured.map((system) => ({
    label: systemLabel(system),
    value: system.metrics.latencyP95Ms,
    secondary: system.metrics.recallAt20,
    group: system.systemName,
  }));

  const evidenceBandwidth = measured.map((system) => ({
    label: systemLabel(system),
    value: system.metrics.evidenceBandwidthPerSecond,
    group: system.systemName,
  }));

  const scaleP95 = measured
    .filter((system) => [10_000, 50_000, 250_000].includes(system.configuration.corpusSize))
    .map((system) => ({
      label: `${format(system.configuration.corpusSize, 0)} / ${system.systemName}`,
      value: system.metrics.latencyP95Ms,
      group: system.systemName,
    }));

  const hydrationSystems = measured.filter((system) =>
    system.systemName === "DERYA_COLD" || system.systemName === "DERYA_HOT");
  const hydration = hydrationSystems.map((system) => ({
    label: systemLabel(system),
    value: system.metrics.hydrationP95Ms,
    group: system.systemName,
  }));

  const safetySystems = measured.filter((system) =>
    finite(system.metrics.staleEscapeRate) || finite(system.metrics.falseConflictRate));
  const safety = safetySystems.map((system) => ({
    label: systemLabel(system),
    value: system.metrics.staleEscapeRate ?? 0,
    secondary: system.metrics.falseConflictRate ?? 0,
    group: system.systemName,
  }));

  return [
    chartShell({
      id: "recall-system",
      title: "Recall@20 by system",
      description: "Gold evidence recovered in the first 20 ranked evidence pointers.",
      svg: barChart(recallBySystem, { percent: true }),
      configurations: graphConfigs(summary, measured),
    }),
    chartShell({
      id: "recall-query-type",
      title: "Recall@20 by query type",
      description: "Evidence recall separated by the benchmark query taxonomy.",
      svg: barChart(recallByQueryType, { percent: true }),
      configurations: graphConfigs(summary, measured),
    }),
    chartShell({
      id: "recall-latency-pareto",
      title: "Recall versus p95 latency Pareto view",
      description: "Measured Recall@20 against end-to-end p95 latency.",
      svg: scatterChart(pareto),
      configurations: graphConfigs(summary, measured),
    }),
    chartShell({
      id: "evidence-bandwidth",
      title: "Evidence bandwidth",
      description: "Correct gold evidence pointers divided by retrieval seconds.",
      svg: barChart(evidenceBandwidth, { unit: "/s" }),
      configurations: graphConfigs(summary, measured),
    }),
    chartShell({
      id: "scale-p95",
      title: "p95 latency at 10K, 50K, and 250K",
      description: "End-to-end p95 latency for measured corpus profiles.",
      svg: barChart(scaleP95, { unit: " ms" }),
      configurations: graphConfigs(summary, measured),
    }),
    chartShell({
      id: "cold-hot-hydration",
      title: "Derya cold versus hot hydration",
      description: "Commercial-state hydration p95 with projections bypassed versus fresh projections.",
      svg: barChart(hydration, { unit: " ms" }),
      configurations: graphConfigs(summary, hydrationSystems),
    }),
    chartShell({
      id: "semantic-concurrency",
      title: "Stale escape and false conflict",
      description: "Safety error rates from measured semantic-concurrency cases. Lower is better.",
      svg: groupedRateChart(safety),
      configurations: graphConfigs(summary, safetySystems),
    }),
  ].join("\n");
}

function metadataRows(summary: BenchmarkSummaryDocument) {
  return summary.runs.map((run) => `<tr>
    <td>${escapeHtml(run.runId)}</td>
    <td>${escapeHtml(run.profile)}</td>
    <td>${escapeHtml(run.systemName)}</td>
    <td>${escapeHtml(run.configuration.status)}</td>
    <td>${format(run.configuration.corpusSize, 0)}</td>
    <td>${format(run.configuration.queryCount, 0)}</td>
    <td>${format(run.configuration.topK, 0)}</td>
    <td>${escapeHtml(run.configuration.embeddingModel)}</td>
    <td>${format(run.configuration.runIndex, 0)} / ${format(run.configuration.runCount, 0)}</td>
    <td>${escapeHtml(run.configuration.hardwareLabel)}</td>
    <td>${escapeHtml(run.configuration.postgresStatementTimeout)}</td>
    <td>${format(run.configuration.prismaPoolConfiguration.connectionLimit, 0)} / ${format(run.configuration.prismaPoolConfiguration.poolTimeoutSeconds, 0)}s</td>
    <td>${escapeHtml(run.configuration.sourceTreeFingerprint)}</td>
    <td>${escapeHtml(run.startedAt)}</td>
    <td>${escapeHtml(run.completedAt)}</td>
    <td>${run.metrics ? format(run.metrics.recallAt20, 4) : escapeHtml(run.configuration.skipReason ?? "not measured")}</td>
    <td>${run.metrics ? format(run.metrics.latencyP95Ms, 2) : ""}</td>
  </tr>`).join("");
}

function multiplierRows(summary: BenchmarkSummaryDocument) {
  return summary.bandwidthMultiplier.map((entry) => `<tr>
    <td>${escapeHtml(entry.profile)}</td>
    <td>${escapeHtml(entry.metric)}</td>
    <td>${finite(entry.value) ? `${format(entry.value, 3)}x` : escapeHtml(entry.reason ?? "not measured")}</td>
  </tr>`).join("");
}

export function renderBenchmarkReport(summary: BenchmarkSummaryDocument) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Derya Commercial State Runtime Benchmark</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #172033; background: #eef2f7; }
    body { margin: 0; }
    main { width: min(1180px, calc(100% - 40px)); margin: 0 auto; padding: 48px 0 80px; }
    h1 { font-size: clamp(2rem, 5vw, 3.6rem); line-height: 1; margin: 0 0 14px; letter-spacing: -0.04em; }
    h2 { margin: 0 0 8px; font-size: 1.45rem; }
    h3 { margin: 28px 0 8px; font-size: .78rem; text-transform: uppercase; letter-spacing: .12em; color: #526077; }
    p { color: #526077; line-height: 1.55; }
    .lede { max-width: 760px; font-size: 1.05rem; }
    .stamp { font-variant-numeric: tabular-nums; }
    .chart, .table-card { margin-top: 26px; padding: 28px; border: 1px solid #d7deea; border-radius: 16px; background: white; box-shadow: 0 8px 30px rgba(28, 39, 60, .05); }
    svg { display: block; width: 100%; height: auto; overflow: visible; margin-top: 22px; }
    svg text { font-family: inherit; fill: #334155; }
    .label { font-size: 12px; }
    .small-label { font-size: 10px; }
    .value { font-size: 12px; font-variant-numeric: tabular-nums; }
    .axis { stroke: #94a3b8; stroke-width: 1; }
    .axis-label { font-size: 12px; text-anchor: middle; }
    .config { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1px; padding: 1px; margin: 8px 0 0; background: #dbe2ec; border-radius: 10px; overflow: hidden; }
    .config + .config { margin-top: 8px; }
    .config div { padding: 10px 12px; background: #f8fafc; min-width: 0; }
    .config dt { font-size: .68rem; text-transform: uppercase; letter-spacing: .07em; color: #64748b; }
    .config dd { margin: 4px 0 0; font-size: .82rem; overflow-wrap: anywhere; }
    .no-data { margin: 22px 0; padding: 32px; border: 1px dashed #b9c4d4; border-radius: 10px; color: #64748b; text-align: center; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: .78rem; font-variant-numeric: tabular-nums; }
    th, td { padding: 9px 10px; border-bottom: 1px solid #e2e8f0; text-align: left; white-space: nowrap; }
    th { color: #526077; font-size: .68rem; text-transform: uppercase; letter-spacing: .06em; }
    footer { color: #64748b; margin-top: 28px; font-size: .8rem; }
  </style>
</head>
<body>
<main>
  <header>
    <h1>Derya benchmark</h1>
    <p class="lede">Measured retrieval, state hydration, and semantic-concurrency results. Skipped systems are identified in run metadata and are never plotted as measured values.</p>
    <p class="stamp">Generated ${escapeHtml(summary.generatedAt)}</p>
  </header>
  ${reportGraphs(summary)}
  <section class="table-card">
    <h2>Bandwidth multiplier</h2>
    <p>Derya hot bandwidth divided by Strong Hybrid RAG bandwidth. A value is omitted when the vector baseline was not measured.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Profile</th><th>Metric</th><th>Multiplier</th></tr></thead>
      <tbody>${multiplierRows(summary)}</tbody>
    </table></div>
  </section>
  <section class="table-card">
    <h2>Run metadata</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Run ID</th><th>Profile</th><th>System</th><th>Status</th><th>Corpus</th><th>Queries</th><th>Top-K</th><th>Embedding</th><th>Run</th><th>Hardware</th><th>Statement timeout</th><th>Prisma pool</th><th>Source tree SHA-256</th><th>Started</th><th>Completed</th><th>Recall@20</th><th>p95 ms</th></tr></thead>
      <tbody>${metadataRows(summary)}</tbody>
    </table></div>
  </section>
  <footer>Static report. All charts are rendered from summary.json values produced by the benchmark runner.</footer>
</main>
</body>
</html>\n`;
}
