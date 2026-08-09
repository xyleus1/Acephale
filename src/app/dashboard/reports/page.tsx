import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { canonicalInquiryStatus } from "@/lib/inquiry-status";
import Link from "next/link";

export const metadata = { title: "Reports" };

type SearchParams = Promise<{ period?: string }>;
type Tone = "brand" | "info" | "success" | "warning" | "danger" | "muted";

const PERIOD_OPTIONS = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];

const JOB_STATUS_ORDER = ["INQUIRY", "QUOTED", "BOOKED", "IN_TRANSIT", "CUSTOMS", "DELIVERED"] as const;
const JOB_STATUS_META: Record<string, { label: string; tone: Tone }> = {
  INQUIRY: { label: "RFQ", tone: "brand" },
  QUOTED: { label: "Pricing", tone: "warning" },
  BOOKED: { label: "Booked", tone: "info" },
  IN_TRANSIT: { label: "En Route", tone: "brand" },
  CUSTOMS: { label: "Customs", tone: "warning" },
  DELIVERED: { label: "Delivered", tone: "success" },
};

const MODE_LABEL: Record<string, string> = {
  "SEA-FCL": "Sea FCL",
  "SEA-LCL": "Sea LCL",
  AIR: "Air",
  ROAD: "Road",
  COURIER: "Courier",
};

const MODE_TONE: Record<string, Tone> = {
  "SEA-FCL": "brand",
  "SEA-LCL": "info",
  AIR: "muted",
  ROAD: "warning",
  COURIER: "danger",
};

function toneClass(tone?: Tone) {
  return tone ? `tone-${tone}` : "";
}

function marginTone(value: number): Tone {
  if (value >= 20) return "success";
  if (value >= 10) return "warning";
  return "danger";
}

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: Tone;
}) {
  return (
    <div className="card report-kpi">
      <div className="report-kpi-label">{label}</div>
      <div className={["report-kpi-value", toneClass(tone)].filter(Boolean).join(" ")}>{value}</div>
      {sub && <div className="report-kpi-sub">{sub}</div>}
    </div>
  );
}

function Measure({
  label,
  value,
  total,
  meta,
  tone = "brand",
}: {
  label: string;
  value: number;
  total: number;
  meta: React.ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="report-measure">
      <div className="report-measure-head">
        <span className="report-measure-label">{label}</span>
        <span className="report-measure-value">{meta}</span>
      </div>
      <progress className={["report-progress", toneClass(tone)].join(" ")} value={value} max={Math.max(total, 1)} />
    </div>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession();
  const { period = "30" } = await searchParams;
  const days = parseInt(period, 10) || 30;
  const since = new Date(Date.now() - days * 86_400_000);

  const [jobsAll, jobsRecent, inquiriesRecent, deliveredJobs, carrierQuotes] = await Promise.all([
    prisma.job.findMany({
      where: { officeId: session.officeId },
      include: { company: { select: { id: true, name: true } } },
    }),
    prisma.job.findMany({
      where: { officeId: session.officeId, createdAt: { gte: since } },
    }),
    prisma.inquiry.findMany({
      where: { officeId: session.officeId, receivedAt: { gte: since } },
      select: { id: true, status: true, mode: true, receivedAt: true },
    }),
    prisma.job.findMany({
      where: { officeId: session.officeId, status: "DELIVERED", updatedAt: { gte: since } },
      include: { milestones: { where: { type: "ETA" } } },
    }),
    prisma.carrierQuote.findMany({
      where: { inquiry: { officeId: session.officeId, receivedAt: { gte: since } } },
      include: { inquiry: { select: { mode: true } } },
    }),
  ]);

  const pipeByStatus = JOB_STATUS_ORDER.map((s) => {
    const list = jobsAll.filter((j) => j.status === s);
    const value = list.reduce((sum, j) => sum + (j.revenue ?? 0), 0);
    return { status: s, count: list.length, value };
  });
  const pipeTotal = pipeByStatus.reduce((s, x) => s + x.count, 0);
  const pipelineValue = pipeByStatus.reduce((s, p) => s + p.value, 0);

  const activeJobs = jobsAll.filter((j) => !["DELIVERED", "CANCELLED"].includes(j.status));
  const inTransitValue = jobsAll
    .filter((j) => ["BOOKED", "IN_TRANSIT", "CUSTOMS"].includes(j.status))
    .reduce((s, j) => s + (j.revenue ?? 0), 0);

  // Funnel over canonical statuses (canonicalInquiryStatus maps legacy values;
  // PRICING merges the old PRICED+QUOTED stages, so "quoted" counts raw QUOTED
  // rows plus rows with a known outcome).
  const canon = new Map(inquiriesRecent.map((i) => [i, canonicalInquiryStatus(i.status)]));
  const rfqByStatus = {
    received: inquiriesRecent.length,
    parsed: inquiriesRecent.filter((i) => i.status === "PARSED" || ["PRICING", "BOOKED", "MISSED"].includes(canon.get(i)!)).length,
    priced: inquiriesRecent.filter((i) => ["PRICING", "BOOKED", "MISSED"].includes(canon.get(i)!)).length,
    quoted: inquiriesRecent.filter((i) => i.status === "QUOTED" || ["BOOKED", "MISSED"].includes(canon.get(i)!)).length,
    won: inquiriesRecent.filter((i) => canon.get(i) === "BOOKED").length,
  };
  const rfqWinRate = rfqByStatus.won + rfqByStatus.quoted > 0
    ? Math.round((rfqByStatus.won / Math.max(rfqByStatus.won + rfqByStatus.quoted, 1)) * 100)
    : 0;

  const closedRev = jobsRecent.filter((j) => j.revenue).reduce((s, j) => s + (j.revenue ?? 0), 0);
  const closedCost = jobsRecent.filter((j) => j.cost).reduce((s, j) => s + (j.cost ?? 0), 0);
  const grossMargin = closedRev - closedCost;
  const marginPct = closedRev > 0 ? (grossMargin / closedRev) * 100 : 0;

  let onTime = 0;
  let late = 0;
  for (const j of deliveredJobs) {
    const eta = j.milestones[0]?.plannedAt;
    const actual = j.milestones[0]?.actualAt ?? j.updatedAt;
    if (!eta) continue;
    if (new Date(actual) <= new Date(eta)) onTime++; else late++;
  }
  const otdPct = onTime + late > 0 ? Math.round((onTime / (onTime + late)) * 100) : null;

  const modeAgg: Record<string, { count: number; revenue: number }> = {};
  for (const j of jobsAll) {
    const m = j.mode ?? "OTHER";
    if (!modeAgg[m]) modeAgg[m] = { count: 0, revenue: 0 };
    modeAgg[m].count++;
    modeAgg[m].revenue += j.revenue ?? 0;
  }
  const modeRows = Object.entries(modeAgg).sort((a, b) => b[1].revenue - a[1].revenue);
  const modeTotalRev = modeRows.reduce((s, [, v]) => s + v.revenue, 0);

  const customerAgg = new Map<string, { name: string; jobs: number; revenue: number }>();
  for (const j of jobsAll) {
    if (!j.companyId) continue;
    const cur = customerAgg.get(j.companyId) ?? { name: j.company?.name ?? "-", jobs: 0, revenue: 0 };
    cur.jobs++;
    cur.revenue += j.revenue ?? 0;
    customerAgg.set(j.companyId, cur);
  }
  const topCustomers = [...customerAgg.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 6);
  const topCustomerMax = topCustomers[0]?.[1].revenue ?? 1;

  const laneAgg = new Map<string, { jobs: number; revenue: number; cost: number }>();
  for (const j of jobsAll) {
    if (!j.origin || !j.destination) continue;
    const key = `${j.origin} to ${j.destination}`;
    const cur = laneAgg.get(key) ?? { jobs: 0, revenue: 0, cost: 0 };
    cur.jobs++;
    cur.revenue += j.revenue ?? 0;
    cur.cost += j.cost ?? 0;
    laneAgg.set(key, cur);
  }
  const topLanes = [...laneAgg.entries()]
    .filter(([, v]) => v.revenue > 0)
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 5);

  const carrierAgg = new Map<string, { quotes: number; avgTransit: number; transitN: number }>();
  for (const cq of carrierQuotes) {
    const cur = carrierAgg.get(cq.carrier) ?? { quotes: 0, avgTransit: 0, transitN: 0 };
    cur.quotes++;
    if (cq.transitDays) {
      cur.avgTransit = (cur.avgTransit * cur.transitN + cq.transitDays) / (cur.transitN + 1);
      cur.transitN++;
    }
    carrierAgg.set(cq.carrier, cur);
  }
  const topCarriers = [...carrierAgg.entries()].sort((a, b) => b[1].quotes - a[1].quotes).slice(0, 5);

  const funnelRows = [
    { label: "Received", count: rfqByStatus.received, tone: "brand" as Tone },
    { label: "Parsed", count: rfqByStatus.parsed, tone: "info" as Tone },
    { label: "Priced", count: rfqByStatus.priced, tone: "warning" as Tone },
    { label: "Quoted", count: rfqByStatus.quoted, tone: "brand" as Tone },
    { label: "Won", count: rfqByStatus.won, tone: "success" as Tone },
  ];

  return (
    <div className="report-page">
      <div className="page-header report-page-header">
        <div>
          <h1 className="page-title">Reports</h1>
        </div>
        <div className="report-period-control" aria-label="Report period">
          {PERIOD_OPTIONS.map((opt) => (
            <Link
              key={opt.value}
              href={`?period=${opt.value}`}
              className={["report-period-link", period === opt.value ? "active" : ""].filter(Boolean).join(" ")}
            >
              {opt.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="report-kpi-grid">
        <Kpi label="Active Jobs" value={activeJobs.length} sub={`of ${jobsAll.length} total`} />
        <Kpi label="In-Flight Value" value={`$${(inTransitValue / 1000).toFixed(1)}k`} tone="brand" sub="Booked to customs" />
        <Kpi label="RFQs Received" value={rfqByStatus.received} sub={`last ${days}d`} tone="brand" />
        <Kpi label="Win Rate" value={`${rfqWinRate}%`} sub={`${rfqByStatus.won} won`} tone={rfqWinRate >= 50 ? "success" : rfqWinRate >= 30 ? "warning" : "danger"} />
        <Kpi label="Gross Margin" value={`${marginPct.toFixed(1)}%`} sub={`$${grossMargin.toLocaleString()}`} tone={marginTone(marginPct)} />
        <Kpi label="On-Time Delivery" value={otdPct != null ? `${otdPct}%` : "-"} sub={`${onTime}/${onTime + late} delivered`} tone={otdPct != null && otdPct >= 90 ? "success" : "warning"} />
      </div>

      <div className="report-grid pipeline">
        <section className="card report-card">
          <header className="report-card-header">
            <h2 className="report-card-title">Job Pipeline</h2>
            <span className="report-card-note">{pipeTotal} total · ${(pipelineValue / 1000).toFixed(1)}k value</span>
          </header>
          <div className="report-card-body">
            {pipeByStatus.map((p) => {
              const meta = JOB_STATUS_META[p.status];
              return (
                <Measure
                  key={p.status}
                  label={meta.label}
                  value={p.count}
                  total={pipeTotal}
                  tone={meta.tone}
                  meta={(
                    <>
                      <strong>{p.count}</strong>
                      {p.value > 0 && <span className="report-measure-extra">${(p.value / 1000).toFixed(1)}k</span>}
                    </>
                  )}
                />
              );
            })}
          </div>
        </section>

        <section className="card report-card">
          <header className="report-card-header">
            <h2 className="report-card-title">RFQ Funnel ({days}d)</h2>
          </header>
          <div className="report-card-body">
            {funnelRows.map((step, i, all) => {
              const drop = i === 0 ? 0 : Math.max(all[i - 1].count - step.count, 0);
              return (
                <Measure
                  key={step.label}
                  label={step.label}
                  value={step.count}
                  total={rfqByStatus.received || 1}
                  tone={step.tone}
                  meta={(
                    <>
                      <strong>{step.count}</strong>
                      {drop > 0 && <span className="report-measure-extra danger">-{drop}</span>}
                    </>
                  )}
                />
              );
            })}
          </div>
        </section>
      </div>

      <div className="report-grid revenue">
        <section className="card report-card">
          <header className="report-card-header">
            <h2 className="report-card-title">Mode Mix</h2>
          </header>
          <div className="report-card-body">
            {modeRows.length === 0 ? (
              <div className="report-empty compact">No jobs yet.</div>
            ) : modeRows.map(([m, v]) => (
              <Measure
                key={m}
                label={MODE_LABEL[m] ?? m}
                value={v.revenue}
                total={modeTotalRev || 1}
                tone={MODE_TONE[m] ?? "muted"}
                meta={(
                  <>
                    <strong>{v.count}</strong>
                    <span className="report-measure-extra">${(v.revenue / 1000).toFixed(1)}k</span>
                  </>
                )}
              />
            ))}
          </div>
        </section>

        <section className="card report-card">
          <header className="report-card-header">
            <h2 className="report-card-title">Top Customers (revenue)</h2>
          </header>
          <div className="report-card-body">
            {topCustomers.length === 0 ? (
              <div className="report-empty compact">No revenue yet.</div>
            ) : topCustomers.map(([id, v]) => (
              <Link key={id} href={`/dashboard/crm?q=${encodeURIComponent(v.name)}`} className="report-link-measure">
                <Measure
                  label={v.name}
                  value={v.revenue}
                  total={topCustomerMax}
                  tone="brand"
                  meta={(
                    <>
                      <strong>${(v.revenue / 1000).toFixed(1)}k</strong>
                      <span className="report-measure-extra">{v.jobs} jobs</span>
                    </>
                  )}
                />
              </Link>
            ))}
          </div>
        </section>
      </div>

      <div className="report-grid tables">
        <section className="card report-card">
          <header className="report-card-header">
            <h2 className="report-card-title">Top Lanes (margin)</h2>
          </header>
          {topLanes.length === 0 ? (
            <div className="report-empty">No lane data yet.</div>
          ) : (
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Lane</th>
                    <th className="right">Jobs</th>
                    <th className="right">Revenue</th>
                    <th className="right">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {topLanes.map(([lane, v]) => {
                    const m = v.revenue > 0 ? ((v.revenue - v.cost) / v.revenue) * 100 : 0;
                    return (
                      <tr key={lane}>
                        <td className="lane-cell">{lane}</td>
                        <td className="right">{v.jobs}</td>
                        <td className="right strong">${(v.revenue / 1000).toFixed(1)}k</td>
                        <td className={["right", "strong", toneClass(marginTone(m))].join(" ")}>{m.toFixed(1)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card report-card">
          <header className="report-card-header">
            <h2 className="report-card-title">Carrier Performance ({days}d)</h2>
          </header>
          {topCarriers.length === 0 ? (
            <div className="report-empty">No carrier quotes yet.</div>
          ) : (
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Carrier</th>
                    <th className="right">Quotes</th>
                    <th className="right">Avg Transit</th>
                  </tr>
                </thead>
                <tbody>
                  {topCarriers.map(([carrier, v]) => (
                    <tr key={carrier}>
                      <td className="strong">{carrier}</td>
                      <td className="right">{v.quotes}</td>
                      <td className="right muted">{v.transitN > 0 ? `${v.avgTransit.toFixed(0)}d` : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
