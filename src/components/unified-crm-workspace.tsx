import Link from "next/link";
import { revalidatePath } from "next/cache";
import { CategoryType, CustomerStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { refreshRiskAlerts } from "@/lib/risk";
import { Badge, EmptyState, statusTone } from "@/components/ui";
import { MoreFiltersToggle } from "@/components/filter-bar";
import { getLang, getT } from "@/lib/i18n";
import { StatusBadgeToggle } from "@/components/status-badge-toggle";

const statuses = Object.values(CustomerStatus);
const pageSizes = [10, 25, 50, 100];

type SearchParams = Promise<{
  q?: string;
  status?: string;
  class1?: string;
  class2?: string;
  product?: string;
  lane?: string;
  direction?: string;
  page?: string;
  pageSize?: string;
  sortBy?: string;
  sortDir?: string;
  viewId?: string;
}>;

const BASE = "/dashboard/customers";

export async function UnifiedCrmWorkspace({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const lang = await getLang();
  const t = getT(lang);
  const STATUS_LABELS = t.statuses;
  const session = await requireSession();
  const query = await searchParams;
  const selectedViewId = query.viewId ?? "";
  const canViewAll = session.role === "ADMIN" || session.role === "MANAGER" || session.canViewWholeOffice;
  const companyScope = canViewAll
    ? { officeId: session.officeId }
    : { officeId: session.officeId, owners: { some: { userId: session.userId } } };
  const savedViews = await prisma.savedView.findMany({
    where: { officeId: session.officeId, userId: session.userId },
    orderBy: { createdAt: "desc" }
  });

  const selectedView = selectedViewId
    ? await prisma.savedView.findFirst({
        where: { id: selectedViewId, officeId: session.officeId, userId: session.userId }
      })
    : null;

  const viewFilters = (selectedView?.filters as Record<string, string> | null) ?? {};
  const effectiveQuery = {
    q: query.q ?? viewFilters.q ?? "",
    status: query.status ?? viewFilters.status ?? "",
    class1: query.class1 ?? viewFilters.class1 ?? "",
    class2: query.class2 ?? viewFilters.class2 ?? "",
    product: query.product ?? viewFilters.product ?? "",
    lane: query.lane ?? viewFilters.lane ?? "",
    direction: query.direction ?? viewFilters.direction ?? "",
    sortBy: query.sortBy ?? viewFilters.sortBy ?? "updatedAt",
    sortDir: query.sortDir ?? viewFilters.sortDir ?? "desc"
  };

  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
  const requestedPageSize = Number.parseInt(query.pageSize ?? "25", 10) || 25;
  const pageSize = pageSizes.includes(requestedPageSize) ? requestedPageSize : 25;
  const offset = (page - 1) * pageSize;

  const where = {
    ...companyScope,
    ...(effectiveQuery.q
      ? { name: { contains: effectiveQuery.q } }
      : {}),
    ...(effectiveQuery.status ? { status: effectiveQuery.status as CustomerStatus } : {}),
    ...(effectiveQuery.class1 ? { class1: effectiveQuery.class1 } : {}),
    ...(effectiveQuery.class2 ? { class2: effectiveQuery.class2 } : {}),
    ...(effectiveQuery.product ? { product: effectiveQuery.product } : {}),
    ...(effectiveQuery.lane ? { lane: effectiveQuery.lane } : {}),
    ...(effectiveQuery.direction ? { direction: effectiveQuery.direction } : {})
  };

  const sortByAllowed = new Set(["updatedAt", "name", "status", "createdAt"]);
  const sortBy = sortByAllowed.has(effectiveQuery.sortBy) ? effectiveQuery.sortBy : "updatedAt";
  const sortDir = effectiveQuery.sortDir === "asc" ? "asc" : "desc";

  const [
    companyCount,
    contactCount,
    activityCount,
    quoteCount,
    openTaskCount,
    openRiskAlertCount,
    companies,
    totalCount,
    users,
    categories,
    statusBreakdown
  ] = await Promise.all([
    prisma.company.count({ where: companyScope }),
    prisma.contact.count({ where: { company: companyScope } }),
    prisma.activity.count({ where: { officeId: session.officeId } }),
    prisma.quote.count({ where: { officeId: session.officeId } }),
    prisma.task.count({
      where: {
        officeId: session.officeId,
        status: "OPEN",
        company: canViewAll ? undefined : { owners: { some: { userId: session.userId } } }
      }
    }),
    prisma.riskAlert.count({
      where: {
        officeId: session.officeId,
        isOpen: true,
        company: canViewAll ? undefined : { owners: { some: { userId: session.userId } } }
      }
    }),
    prisma.company.findMany({
      where,
      include: {
        owners: { include: { user: true } },
        contacts: { take: 1 },
        activities: { orderBy: { occurredAt: "desc" }, take: 1 }
      },
      orderBy: { [sortBy]: sortDir },
      skip: offset,
      take: pageSize
    }),
    prisma.company.count({ where }),
    prisma.user.findMany({
      where: { officeId: session.officeId, isActive: true },
      orderBy: { fullName: "asc" }
    }),
    prisma.categoryOption.findMany({
      where: { officeId: session.officeId, isActive: true },
      orderBy: [{ type: "asc" }, { value: "asc" }]
    }),
    prisma.company.groupBy({
      by: ["status"],
      where,
      _count: { _all: true }
    })
  ]);

  const class1Options = categories.filter((x) => x.type === CategoryType.CLASS1);
  const class2Options = categories.filter((x) => x.type === CategoryType.CLASS2);
  const productOptions = categories.filter((x) => x.type === CategoryType.PRODUCT);
  const laneOptions = categories.filter((x) => x.type === CategoryType.LANE);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const previousPage = Math.max(1, page - 1);
  const nextPage = Math.min(totalPages, page + 1);

  const untouchedCount = statusBreakdown.find((i) => i.status === "UNTOUCHED")?._count._all ?? 0;
  const inProgressCount = statusBreakdown.find((i) => i.status === "IN_PROGRESS")?._count._all ?? 0;
  const workedCount = statusBreakdown.find((i) => i.status === "WORKED")?._count._all ?? 0;
  const lostCount = statusBreakdown.find((i) => i.status === "LOST")?._count._all ?? 0;

  function daysSince(date: Date | null): number | null {
    if (!date) return null;
    return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  }

  function sortLink(field: string) {
    const newDir = sortBy === field && sortDir === "desc" ? "asc" : "desc";
    return buildQueryString({ sortBy: field, sortDir: newDir, page: "1" });
  }

  function sortArrow(field: string) {
    if (sortBy !== field) return <span style={{ color: "var(--border-strong)", marginLeft: 3 }}>↕</span>;
    return <span style={{ color: "var(--brand)", marginLeft: 3 }}>{sortDir === "desc" ? "↓" : "↑"}</span>;
  }

  function buildQueryString(overrides: Record<string, string>) {
    const params = new URLSearchParams({
      q: effectiveQuery.q,
      status: effectiveQuery.status,
      class1: effectiveQuery.class1,
      class2: effectiveQuery.class2,
      product: effectiveQuery.product,
      lane: effectiveQuery.lane,
      direction: effectiveQuery.direction,
      page: String(page),
      pageSize: String(pageSize),
      sortBy,
      sortDir,
      ...(selectedViewId ? { viewId: selectedViewId } : {})
    });
    Object.entries(overrides).forEach(([k, v]) => params.set(k, v));
    return `?${params.toString()}`;
  }

  async function refreshRiskAction() {
    "use server";
    const s = await requireSession();
    if (s.role !== "ADMIN" && s.role !== "MANAGER") return;
    await refreshRiskAlerts(s.officeId);
    revalidatePath(BASE);
  }

  async function createCompanyAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return;

    const created = await prisma.company.create({
      data: { officeId: s.officeId, name, status: "UNTOUCHED" }
    });

    // Auto-assign to the person creating it
    await prisma.companyOwner.create({
      data: { companyId: created.id, userId: s.userId, isPrimary: true }
    });
    await prisma.assignmentChange.create({
      data: {
        officeId: s.officeId,
        companyId: created.id,
        changedByUserId: s.userId,
        diff: { type: "initial_assign", ownerIds: [s.userId] }
      }
    });

    await prisma.event.create({
      data: {
        officeId: s.officeId,
        type: "company.created",
        entityType: "company",
        entityId: created.id,
        payload: { name: created.name }
      }
    });

    revalidatePath(BASE);
  }

  async function bulkUpdateStatusAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const companyIds = formData.getAll("companyIds").map((v) => String(v));
    const status = String(formData.get("bulkStatus") ?? "") as CustomerStatus;
    if (companyIds.length === 0 || !statuses.includes(status)) return;

    await prisma.company.updateMany({
      where: { officeId: s.officeId, id: { in: companyIds } },
      data: { status }
    });

    await prisma.event.create({
      data: {
        officeId: s.officeId,
        type: "company.bulk_status_update",
        payload: { companyIds, status }
      }
    });

    revalidatePath(BASE);
  }

  async function saveViewAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const name = String(formData.get("viewName") ?? "").trim();
    if (!name) return;

    const filters = {
      q: String(formData.get("q") ?? ""),
      status: String(formData.get("status") ?? ""),
      class1: String(formData.get("class1") ?? ""),
      class2: String(formData.get("class2") ?? ""),
      product: String(formData.get("product") ?? ""),
      lane: String(formData.get("lane") ?? ""),
      direction: String(formData.get("direction") ?? ""),
      sortBy: String(formData.get("sortBy") ?? "updatedAt"),
      sortDir: String(formData.get("sortDir") ?? "desc")
    };

    await prisma.savedView.upsert({
      where: { officeId_userId_name: { officeId: s.officeId, userId: s.userId, name } },
      update: { filters },
      create: { officeId: s.officeId, userId: s.userId, name, filters }
    });
    revalidatePath(BASE);
  }

  const hasActiveFilters = !!(effectiveQuery.q || effectiveQuery.status || effectiveQuery.class1 || effectiveQuery.class2 || effectiveQuery.product || effectiveQuery.lane || effectiveQuery.direction);

  return (
    <div className="stack-sections">

      {/* ── Page Header ──────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{t.customers.pageTitle}</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 4, flexWrap: "wrap" }}>
            <p className="page-subtitle" style={{ margin: 0 }}>{companyCount} {t.customers.accounts}</p>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "var(--text-3)" }}>{contactCount} contacts</span>
              <span style={{ fontSize: 12, color: "var(--text-3)" }}>{activityCount} touches</span>
              {openRiskAlertCount > 0 && (
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--danger)" }}>
                  {openRiskAlertCount} alerts
                </span>
              )}
              {openTaskCount > 0 && (
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--warning)" }}>
                  {openTaskCount} tasks
                </span>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a
            href={`/api/export/companies?q=${encodeURIComponent(effectiveQuery.q)}&status=${encodeURIComponent(effectiveQuery.status)}&class1=${encodeURIComponent(effectiveQuery.class1)}&class2=${encodeURIComponent(effectiveQuery.class2)}&product=${encodeURIComponent(effectiveQuery.product)}&lane=${encodeURIComponent(effectiveQuery.lane)}`}
            download
          >
            <button type="button" className="secondary btn-sm">⬇ {t.customers.exportCsv}</button>
          </a>
          {(session.role === "ADMIN" || session.role === "MANAGER") && (
            <form action={refreshRiskAction}>
              <button type="submit" className="secondary btn-sm" style={{ color: "var(--text-3)" }}>{t.customers.refreshRisk}</button>
            </form>
          )}
        </div>
      </div>

      {/* ── Customer Pool ─────────────────────────────────────── */}
      <div className="card">
        <div className="card-body" style={{ paddingBottom: 0 }}>
          <div className="section-header" style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div className="section-title">{t.customers.customerPool}</div>
              <span style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 500 }}>{totalCount} {t.customers.accounts}</span>
            </div>
            <form action={createCompanyAction} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  name="name"
                  required
                  placeholder="Add company name…"
                  style={{ width: 220, height: 32, padding: "0 10px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 6, background: "var(--surface)", color: "var(--text)" }}
                  autoComplete="off"
                />
                <button type="submit" className="btn-sm">+ Add</button>
              </form>
          </div>

          {/* Filter Bar */}
          <form className="filter-bar" method="get" style={{ marginBottom: 10 }}>
            <input
              name="q"
              placeholder={t.customers.searchPlaceholder}
              defaultValue={effectiveQuery.q}
              style={{ flex: "1 1 180px", maxWidth: 260 }}
            />
            <select name="status" defaultValue={effectiveQuery.status} style={{ width: "auto" }}>
              <option value="">{t.customers.allStatuses}</option>
              {statuses.map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>
              ))}
            </select>
            <MoreFiltersToggle hasActive={!!(effectiveQuery.class1 || effectiveQuery.class2 || effectiveQuery.product || effectiveQuery.lane || effectiveQuery.direction)}>
              <>
                {class1Options.length > 0 && (
                  <select name="class1" defaultValue={effectiveQuery.class1} style={{ width: "auto" }}>
                    <option value="">Class 1</option>
                    {class1Options.map((item) => (
                      <option key={item.id} value={item.value}>{item.value}</option>
                    ))}
                  </select>
                )}
                {class2Options.length > 0 && (
                  <select name="class2" defaultValue={effectiveQuery.class2} style={{ width: "auto" }}>
                    <option value="">Class 2</option>
                    {class2Options.map((item) => (
                      <option key={item.id} value={item.value}>{item.value}</option>
                    ))}
                  </select>
                )}
                {productOptions.length > 0 && (
                  <select name="product" defaultValue={effectiveQuery.product} style={{ width: "auto" }}>
                    <option value="">Product</option>
                    {productOptions.map((item) => (
                      <option key={item.id} value={item.value}>{item.value}</option>
                    ))}
                  </select>
                )}
                {laneOptions.length > 0 && (
                  <select name="lane" defaultValue={effectiveQuery.lane} style={{ width: "auto" }}>
                    <option value="">Region</option>
                    {laneOptions.map((item) => (
                      <option key={item.id} value={item.value}>{item.value}</option>
                    ))}
                  </select>
                )}
                <select name="direction" defaultValue={effectiveQuery.direction} style={{ width: "auto" }}>
                  <option value="">Direction</option>
                  <option value="Import">Import</option>
                  <option value="Export">Export</option>
                  <option value="Both">Both</option>
                </select>
              </>
            </MoreFiltersToggle>
            <input type="hidden" name="sortBy" value={sortBy} />
            <input type="hidden" name="sortDir" value={sortDir} />
            <input type="hidden" name="pageSize" value={String(pageSize)} />
            {selectedViewId ? <input type="hidden" name="viewId" value={selectedViewId} /> : null}
            <button type="submit">{t.customers.filter}</button>
            {hasActiveFilters && (
              <Link href={BASE} style={{ fontSize: 12, color: "var(--text-3)" }}>{t.customers.clear}</Link>
            )}
          </form>

          {/* Saved Views — collapsible */}
          <details className="saved-views-details" open={savedViews.length > 0 || !!selectedViewId}>
            <summary className="saved-views-summary">
              <span>{t.customers.savedViews}</span>
              {savedViews.length > 0 && <span className="saved-views-count">{savedViews.length}</span>}
            </summary>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", paddingTop: 8 }}>
              {savedViews.map((v) => (
                <a key={v.id} href={`/dashboard/customers?viewId=${v.id}`}
                  style={{
                    fontSize: 12, padding: "2px 10px", borderRadius: 4, textDecoration: "none",
                    background: selectedViewId === v.id ? "var(--brand-light)" : "var(--surface-2)",
                    border: `1px solid ${selectedViewId === v.id ? "var(--brand-border)" : "var(--border)"}`,
                    color: selectedViewId === v.id ? "var(--brand)" : "var(--text-2)",
                    fontWeight: selectedViewId === v.id ? 600 : 400
                  }}>
                  {v.name}
                </a>
              ))}
              <form action={saveViewAction} style={{ display: "flex", gap: 4, alignItems: "center", marginLeft: "auto" }}>
                <input type="hidden" name="q" value={effectiveQuery.q} />
                <input type="hidden" name="status" value={effectiveQuery.status} />
                <input type="hidden" name="class1" value={effectiveQuery.class1} />
                <input type="hidden" name="class2" value={effectiveQuery.class2} />
                <input type="hidden" name="product" value={effectiveQuery.product} />
                <input type="hidden" name="lane" value={effectiveQuery.lane} />
                <input type="hidden" name="direction" value={effectiveQuery.direction} />
                <input type="hidden" name="sortBy" value={sortBy} />
                <input type="hidden" name="sortDir" value={sortDir} />
                <input name="viewName" placeholder={t.customers.saveViewPlaceholder} style={{ fontSize: 12, height: 26, padding: "2px 8px", width: 150 }} />
                <button type="submit" className="secondary btn-sm" style={{ height: 26, fontSize: 11 }}>{t.customers.save}</button>
              </form>
            </div>
          </details>
        </div>

        {/* Table */}
        <div>
          <div className="table-wrap" style={{ margin: "0 0" }}>
            <table style={{ borderRadius: 0, border: "none", borderTop: "1px solid var(--border)", borderBottom: "none" }}>
              <thead>
                <tr>
                  <th><a href={sortLink("name")} style={{ color: "inherit", textDecoration: "none", display: "flex", alignItems: "center" }}>{t.customers.colCompany}{sortArrow("name")}</a></th>
                  <th><a href={sortLink("status")} style={{ color: "inherit", textDecoration: "none", display: "flex", alignItems: "center" }}>{t.customers.colStatus}{sortArrow("status")}</a></th>
                  <th>{t.customers.colOwners}</th>
                  <th><a href={sortLink("updatedAt")} style={{ color: "inherit", textDecoration: "none", display: "flex", alignItems: "center" }}>{t.customers.colLastContact}{sortArrow("updatedAt")}</a></th>
                </tr>
              </thead>
              <tbody>
                {companies.length === 0 ? (
                  <tr>
                    <td colSpan={4}>
                      <EmptyState message={t.customers.noResults} />
                    </td>
                  </tr>
                ) : (
                  companies.map((company) => {
                    const tags = [company.product, company.lane, company.direction, company.class1, company.class2].filter(Boolean);
                    return (
                    <tr key={company.id}>
                      <td>
                        <Link href={`/dashboard/customers/${company.id}`} style={{ fontWeight: 600, color: "var(--brand)" }}>
                          {company.name}
                        </Link>
                        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3, display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                          {tags.length > 0
                            ? tags.map((tag) => (
                                <span key={tag} style={{ background: "var(--surface-3)", border: "1px solid var(--border)", borderRadius: 3, padding: "0 5px" }}>{tag}</span>
                              ))
                            : (company.activities[0]?.subject
                                ? <span style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{company.activities[0].subject}</span>
                                : company.contacts[0]?.fullName
                                  ? <span>{company.contacts[0].fullName}</span>
                                  : null)
                          }
                        </div>
                      </td>
                      <td>
                        <StatusBadgeToggle companyId={company.id} initialStatus={company.status} />
                      </td>
                      <td style={{ fontSize: 12, color: "var(--text-2)" }}>
                        {company.owners.map((o) => o.user.fullName).join(", ") || "—"}
                      </td>
                      <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                        {(() => {
                          const lastDate = company.activities[0]?.occurredAt ?? null;
                          const d = daysSince(lastDate ? new Date(lastDate) : null);
                          if (d === null) return <span style={{ color: "var(--danger)" }}>{t.customers.noActivity}</span>;
                          if (d >= 14) return <span style={{ color: "var(--danger)", fontWeight: 600 }}>{d}d ago</span>;
                          if (d >= 7) return <span style={{ color: "var(--warning)", fontWeight: 600 }}>{d}d ago</span>;
                          return <span style={{ color: "var(--success)" }}>{d}d ago</span>;
                        })()}
                      </td>
                    </tr>
                  )})
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="pagination">
            <div className="pagination-info">
              {totalCount === 0
                ? "No results"
                : `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, totalCount)} of ${totalCount} companies`}
            </div>
            <div className="pagination-controls">
              <form method="get" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <input type="hidden" name="q" value={effectiveQuery.q} />
                <input type="hidden" name="status" value={effectiveQuery.status} />
                <input type="hidden" name="sortBy" value={sortBy} />
                <input type="hidden" name="sortDir" value={sortDir} />
                <select name="pageSize" defaultValue={String(pageSize)} style={{ width: "auto", fontSize: 12, height: 28, padding: "0 6px" }}>
                  {pageSizes.map((size) => (
                    <option key={size} value={size}>{size} / page</option>
                  ))}
                </select>
              </form>
              <a href={page <= 1 ? "#" : buildQueryString({ page: String(previousPage) })}>
                <button type="button" className="secondary btn-sm" disabled={page <= 1}>← Prev</button>
              </a>
              <span className="page-indicator">{page} / {totalPages}</span>
              <a href={page >= totalPages ? "#" : buildQueryString({ page: String(nextPage) })}>
                <button type="button" className="secondary btn-sm" disabled={page >= totalPages}>Next →</button>
              </a>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
