import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { deriveInquirySource } from "@/lib/inquiry-source";
import { Icon } from "@/components/icon";
import { LinkRow } from "@/components/link-row";
import { SyncGoogleSheetButton } from "@/components/sync-google-sheet-button";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  INGESTED: { label: "RFQ",        cls: "badge-info" },
  PARSED:   { label: "Mature RFQ", cls: "badge-neutral" },
  PRICED:   { label: "Pricing",    cls: "badge-warn" },
  QUOTED:   { label: "Quoted",     cls: "badge-good" },
  WON:      { label: "Won",        cls: "badge-good" },
  LOST:     { label: "Lost",       cls: "badge-danger" },
};

const FILTER_TABS = [
  { key: "",         label: "Open" },
  { key: "all",      label: "All" },
  { key: "INGESTED", label: "RFQ" },
  { key: "PARSED",   label: "Mature RFQ" },
  { key: "PRICED",   label: "Pricing" },
  { key: "QUOTED",   label: "Quoted" },
  { key: "WON",      label: "Won" },
  { key: "LOST",     label: "Lost" },
] as const;

function timeAgo(d: Date) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default async function RFQPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await requireSession();
  const { status } = await searchParams;

  const filter = FILTER_TABS.some((t) => t.key === status) ? (status as string) : "";

  const inquiries = await prisma.inquiry.findMany({
    where: {
      officeId: session.officeId,
      ...(filter === ""
        ? { status: { notIn: ["WON", "LOST"] } }
        : filter === "all"
          ? {}
          : { status: filter }),
    },
    include: {
      company: { select: { id: true, name: true } },
      emailThreads: {
        take: 1,
        select: {
          messages: {
            take: 1,
            select: { account: { select: { email: true, provider: true } } },
          },
        },
      },
    },
    orderBy: { receivedAt: "desc" },
    take: 200,
  });

  return (
    <div>
      <div className="page-header page-header-roomy">
        <div>
          <h1 className="page-title">Incoming RFQs</h1>
          <p className="page-subtitle">
            {inquiries.length} {filter === "" ? "open " : ""}RFQ{inquiries.length === 1 ? "" : "s"} shown · newest first
          </p>
        </div>
        <div className="page-actions">
          <SyncGoogleSheetButton />
          <Link href="/dashboard/inbox?view=rfqs" className="btn btn-secondary">
            <Icon name="inbox" size={13} />
            Inbox triage
          </Link>
          <a href="/dashboard/rfq/new" className="btn">
            <Icon name="plus" size={13} strokeWidth={2.5} /> New RFQ
          </a>
        </div>
      </div>

      <div className="mode-tabs" style={{ marginBottom: 16 }}>
        {FILTER_TABS.map((t) => (
          <Link
            key={t.key || "open"}
            href={`/dashboard/rfq${t.key ? `?status=${t.key}` : ""}` as "/dashboard/rfq"}
            className={`mode-tab${filter === t.key ? " active" : ""}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {inquiries.length === 0 ? (
        <div className="card empty-state-card">
          <Icon name="inbox" size={36} className="empty-state-graphic" />
          <div className="empty-state-title">No RFQs match</div>
          <p className="empty-state-copy">
            RFQs arrive from linked email threads or manual entry. Try another status filter, or add one manually.
          </p>
          <a href="/dashboard/rfq/new" className="btn">
            New RFQ
          </a>
        </div>
      ) : (
        <div className="card table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ cursor: "default" }}>Received</th>
                <th style={{ cursor: "default" }}>Subject</th>
                <th style={{ cursor: "default" }}>From</th>
                <th style={{ cursor: "default" }}>Source</th>
                <th style={{ cursor: "default" }}>Lane</th>
                <th style={{ cursor: "default" }}>Mode</th>
                <th style={{ cursor: "default" }}>Status</th>
                <th style={{ cursor: "default" }} className="numeric">Target Price</th>
              </tr>
            </thead>
            <tbody>
              {inquiries.map((inq) => {
                const sm = STATUS_META[inq.status] ?? { label: inq.status, cls: "badge-neutral" };
                const from = inq.fromCompany ?? inq.company?.name ?? inq.fromEmail ?? "—";
                const source = deriveInquirySource(inq);
                return (
                  <LinkRow key={inq.id} href={`/dashboard/rfq/${inq.id}`}>
                    <td className="data-muted">{timeAgo(inq.receivedAt)}</td>
                    <td>
                      <a href={`/dashboard/rfq/${inq.id}`} className="data-cell-strong">
                        {inq.subject}
                      </a>
                    </td>
                    <td>
                      <div>{from}</div>
                      {inq.fromEmail && from !== inq.fromEmail && (
                        <div className="data-subline">{inq.fromEmail}</div>
                      )}
                    </td>
                    <td>
                      <div>{source.label}</div>
                      {source.detail && <div className="data-subline">{source.detail}</div>}
                    </td>
                    <td>
                      {inq.origin || inq.destination ? (
                        <span>{inq.origin ?? "?"} → {inq.destination ?? "?"}</span>
                      ) : (
                        <span className="data-muted">—</span>
                      )}
                    </td>
                    <td>{inq.mode ?? <span className="data-muted">—</span>}</td>
                    <td>
                      <span className={`badge ${sm.cls}`}>{sm.label}</span>
                    </td>
                    <td className="numeric">
                      {inq.targetPrice != null ? (
                        `${inq.targetCurrency ?? "USD"} ${inq.targetPrice.toLocaleString("en-GB")}`
                      ) : (
                        <span className="data-muted">—</span>
                      )}
                    </td>
                  </LinkRow>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
