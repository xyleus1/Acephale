import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { Icon } from "@/components/icon";
import { LinkRow } from "@/components/link-row";

const STATUS_LABEL: Record<string, string> = {
  PROPOSED: "Proposed", INQUIRY: "RFQ", QUOTED: "Pricing", BOOKED: "Booked",
  IN_TRANSIT: "En Route", CUSTOMS: "En Route", DELIVERED: "Delivered", CANCELLED: "Cancelled",
};

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtNum(n: number | null): string {
  return n != null ? n.toLocaleString("en-GB") : "—";
}

export default async function LoadsPage() {
  const session = await requireSession();

  const jobs = await prisma.job.findMany({
    where: { officeId: session.officeId },
    include: {
      company: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  return (
    <div>
      <div className="page-header page-header-roomy">
        <div>
          <h1 className="page-title">Loads</h1>
          <p className="page-subtitle">
            All loads, newest first — spreadsheet view. {jobs.length} row{jobs.length === 1 ? "" : "s"} shown.
          </p>
        </div>
        <div className="page-actions">
          <a href="/dashboard/rfq" className="btn">
            <Icon name="inbox" size={13} />
            Move RFQ into loads
          </a>
        </div>
      </div>

      {jobs.length === 0 ? (
        <div className="card empty-state-card">
          <Icon name="box" size={36} className="empty-state-graphic" />
          <div className="empty-state-title">No loads yet</div>
          <p className="empty-state-copy">
            Loads only appear here when you move an incoming RFQ into loads — open an RFQ and use “Move to loads”.
          </p>
          <a href="/dashboard/rfq" className="btn">
            Open incoming RFQs
          </a>
        </div>
      ) : (
        <div className="card table-shell" style={{ maxHeight: "75vh" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ cursor: "default" }}>Ref</th>
                <th style={{ cursor: "default" }}>Title</th>
                <th style={{ cursor: "default" }}>Customer</th>
                <th style={{ cursor: "default" }}>Origin</th>
                <th style={{ cursor: "default" }}>Destination</th>
                <th style={{ cursor: "default" }}>Mode</th>
                <th style={{ cursor: "default" }}>Status</th>
                <th style={{ cursor: "default" }}>ETD</th>
                <th style={{ cursor: "default" }}>ETA</th>
                <th style={{ cursor: "default" }} className="numeric">Revenue</th>
                <th style={{ cursor: "default" }} className="numeric">Cost</th>
                <th style={{ cursor: "default" }}>Currency</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <LinkRow key={j.id} href={`/dashboard/jobs/${j.id}`}>
                  <td className="data-cell-mono">
                    <a href={`/dashboard/jobs/${j.id}`} className="data-link">
                      {j.reference}
                    </a>
                  </td>
                  <td>{j.title ?? j.commodity ?? <span className="data-muted">—</span>}</td>
                  <td>{j.company?.name ?? <span className="data-muted">—</span>}</td>
                  <td>{j.origin ?? <span className="data-muted">—</span>}</td>
                  <td>{j.destination ?? <span className="data-muted">—</span>}</td>
                  <td>{j.mode ?? <span className="data-muted">—</span>}</td>
                  <td>{STATUS_LABEL[j.status] ?? j.status}</td>
                  <td>{fmtDate(j.etd)}</td>
                  <td>{fmtDate(j.eta)}</td>
                  <td className="numeric">{fmtNum(j.revenue)}</td>
                  <td className="numeric">{fmtNum(j.cost)}</td>
                  <td>{j.currency}</td>
                </LinkRow>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
