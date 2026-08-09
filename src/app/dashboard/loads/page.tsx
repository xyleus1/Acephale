import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { Icon } from "@/components/icon";
import { LinkRow } from "@/components/link-row";
import { OverflowMenu } from "@/components/overflow-menu";

export const metadata = { title: "Loads" };

const STATUS_LABEL: Record<string, string> = {
  PROPOSED: "Proposed", INQUIRY: "RFQ", QUOTED: "Pricing", BOOKED: "Booked",
  IN_TRANSIT: "En Route", CUSTOMS: "En Route", DELIVERED: "Delivered", CANCELLED: "Cancelled",
};

function fmtDate(d: Date | null): string {
  if (!d) return "-";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtNum(n: number | null): string {
  return n != null ? n.toLocaleString("en-GB") : "-";
}

export default async function LoadsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const session = await requireSession();
  const { scope } = await searchParams;
  const mine = scope === "mine";
  const isEmployee = session.role === "EMPLOYEE";

  const jobs = await prisma.job.findMany({
    where: {
      officeId: session.officeId,
      // "My loads": the personal board - only what's assigned to me.
      ...(mine ? { assignedToUserId: session.userId } : {}),
    },
    include: {
      company: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, fullName: true } },
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
            {mine ? "Assigned to you" : "All loads"}, {jobs.length} total
          </p>
        </div>
        <div className="page-actions">
          <div className="mode-tabs">
            <a href="/dashboard/loads" className={`mode-tab${!mine ? " active" : ""}`}>
              <Icon name="grid" size={13} />
              All loads
            </a>
            <a href="/dashboard/loads?scope=mine" className={`mode-tab${mine ? " active" : ""}`}>
              <Icon name="user" size={13} />
              My loads
            </a>
          </div>
          {!isEmployee && (
            <OverflowMenu>
              <a href="/dashboard/rfq" className="btn btn-secondary">
                <Icon name="inbox" size={13} />
                Open RFQs
              </a>
            </OverflowMenu>
          )}
        </div>
      </div>

      {jobs.length === 0 ? (
        <div className="card empty-state-card">
          <Icon name="box" size={36} className="empty-state-graphic" />
          <div className="empty-state-title">{mine ? "No loads assigned to you" : "No loads yet"}</div>
          <p className="empty-state-copy">
            {mine
              ? "Open a load from the general board and take it, or ask an admin to assign one to you."
              : "Loads only appear here when you move an incoming RFQ into loads - open an RFQ and use “Move to loads”."}
          </p>
          {mine ? (
            <a href="/dashboard/loads" className="btn">
              Open all loads
            </a>
          ) : !isEmployee ? (
            <a href="/dashboard/rfq" className="btn">
              Open incoming RFQs
            </a>
          ) : null}
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
                <th style={{ cursor: "default" }}>Assigned</th>
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
                  <td>{j.title ?? j.commodity ?? <span className="data-muted">-</span>}</td>
                  <td>{j.company?.name ?? <span className="data-muted">-</span>}</td>
                  <td>{j.origin ?? <span className="data-muted">-</span>}</td>
                  <td>{j.destination ?? <span className="data-muted">-</span>}</td>
                  <td>{j.mode ?? <span className="data-muted">-</span>}</td>
                  <td>{STATUS_LABEL[j.status] ?? j.status}</td>
                  <td>
                    {j.assignedTo
                      ? j.assignedToUserId === session.userId
                        ? <span className="data-cell-strong">You</span>
                        : j.assignedTo.fullName
                      : <span className="data-muted">-</span>}
                  </td>
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
