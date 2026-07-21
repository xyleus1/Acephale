import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { getLang, getT } from "@/lib/i18n";
import { EmptyState } from "@/components/ui";

type SearchParams = Promise<{ q?: string }>;

export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession();
  const lang = await getLang();
  const t = getT(lang);
  const { q = "" } = await searchParams;
  const query = q.trim();

  const canViewAll =
    session.role === "ADMIN" ||
    session.role === "MANAGER" ||
    session.canViewWholeOffice;
  const companyScope = canViewAll
    ? { officeId: session.officeId }
    : { officeId: session.officeId, owners: { some: { userId: session.userId } } };

  if (!query) {
    return (
      <div className="stack-sections">
        <div className="page-header">
          <div><h1 className="page-title">{t.search.pageTitle}</h1></div>
        </div>
        <form method="get" style={{ display: "flex", gap: 8, maxWidth: 520 }}>
          <input name="q" placeholder={t.search.placeholder} autoFocus style={{ flex: 1 }} />
          <button type="submit">{t.search.pageTitle}</button>
        </form>
        <div className="card">
          <div className="card-body">
            <EmptyState message={t.search.searchPrompt} />
          </div>
        </div>
      </div>
    );
  }

  const companyWhere = {
    ...companyScope,
    name: { contains: query },
  };
  const contactWhere = {
    company: companyScope,
    OR: [
      { fullName: { contains: query } },
      { email: { contains: query } },
      { phone: { contains: query } },
    ],
  };
  const activityWhere = {
    officeId: session.officeId,
    OR: [
      { subject: { contains: query } },
      { body: { contains: query } },
    ],
  };

  const [companies, contacts, activities] = await Promise.all([
    prisma.company.findMany({
      where: { ...companyWhere, officeId: session.officeId },
      include: { owners: { include: { user: { select: { fullName: true } } } } },
      take: 20,
    }),
    prisma.contact.findMany({
      where: { ...contactWhere, company: { ...companyScope, officeId: session.officeId } },
      include: { company: { select: { id: true, name: true } } },
      take: 20,
    }),
    prisma.activity.findMany({
      where: { ...activityWhere, officeId: session.officeId },
      include: { company: { select: { id: true, name: true } } },
      orderBy: { occurredAt: "desc" },
      take: 20,
    }),
  ]);

  const total = companies.length + contacts.length + activities.length;

  return (
    <div className="stack-sections">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t.search.pageTitle}</h1>
          <p className="page-subtitle">
            {t.search.resultsFor} &ldquo;{query}&rdquo; - {total} results
          </p>
        </div>
      </div>

      <form method="get" style={{ display: "flex", gap: 8, maxWidth: 520 }}>
        <input name="q" defaultValue={query} placeholder={t.search.placeholder} autoFocus style={{ flex: 1 }} />
        <button type="submit">{t.search.pageTitle}</button>
      </form>

      {total === 0 && (
        <div className="card">
          <div className="card-body">
            <EmptyState message={t.search.noResults} />
          </div>
        </div>
      )}

      {companies.length > 0 && (
        <div className="card">
          <div className="card-body" style={{ paddingBottom: 12 }}>
            <div className="section-header">
              <div className="section-title">{t.search.companies}</div>
              <span style={{ fontSize: 12, color: "var(--text-3)" }}>{companies.length}</span>
            </div>
          </div>
          <div className="table-wrap">
            <table style={{ border: "none", borderTop: "1px solid var(--border)", borderRadius: 0 }}>
              <thead>
                <tr>
                  <th>{t.search.colName}</th>
                  <th>{t.customers.colStatus}</th>
                  <th>{t.customers.colOwners}</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/dashboard/crm?q=${encodeURIComponent(c.name)}`} style={{ fontWeight: 600, color: "var(--brand)" }}>
                        {c.name}
                      </Link>
                    </td>
                    <td style={{ fontSize: 12 }}>{t.statuses[c.status as keyof typeof t.statuses] ?? c.status}</td>
                    <td style={{ fontSize: 12, color: "var(--text-2)" }}>
                      {c.owners.map((o) => o.user.fullName).join(", ") || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {contacts.length > 0 && (
        <div className="card">
          <div className="card-body" style={{ paddingBottom: 12 }}>
            <div className="section-header">
              <div className="section-title">{t.search.contacts}</div>
              <span style={{ fontSize: 12, color: "var(--text-3)" }}>{contacts.length}</span>
            </div>
          </div>
          <div className="table-wrap">
            <table style={{ border: "none", borderTop: "1px solid var(--border)", borderRadius: 0 }}>
              <thead>
                <tr>
                  <th>{t.search.colName}</th>
                  <th>{t.search.colCompany}</th>
                  <th>Email</th>
                  <th>Phone</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 500 }}>{c.fullName}</td>
                    <td>
                      <Link href={`/dashboard/crm?q=${encodeURIComponent(c.company.name)}`} style={{ color: "var(--brand)" }}>
                        {c.company.name}
                      </Link>
                    </td>
                    <td style={{ fontSize: 12, color: "var(--text-2)" }}>{c.email ?? "-"}</td>
                    <td style={{ fontSize: 12, color: "var(--text-2)" }}>{c.phone ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activities.length > 0 && (
        <div className="card">
          <div className="card-body" style={{ paddingBottom: 12 }}>
            <div className="section-header">
              <div className="section-title">{t.search.activities}</div>
              <span style={{ fontSize: 12, color: "var(--text-3)" }}>{activities.length}</span>
            </div>
          </div>
          <div className="table-wrap">
            <table style={{ border: "none", borderTop: "1px solid var(--border)", borderRadius: 0 }}>
              <thead>
                <tr>
                  <th>{t.search.colDate}</th>
                  <th>{t.search.colType}</th>
                  <th>{t.search.colName}</th>
                  <th>{t.search.colCompany}</th>
                </tr>
              </thead>
              <tbody>
                {activities.map((a) => (
                  <tr key={a.id}>
                    <td style={{ fontSize: 12, whiteSpace: "nowrap", color: "var(--text-3)" }}>
                      {new Date(a.occurredAt).toLocaleDateString()}
                    </td>
                    <td style={{ fontSize: 11 }}>
                      <span style={{ background: "var(--surface-3)", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 6px" }}>
                        {a.type}
                      </span>
                    </td>
                    <td style={{ fontWeight: 500 }}>{a.subject ?? "-"}</td>
                    <td>
                      <Link href={`/dashboard/crm?q=${encodeURIComponent(a.company.name)}`} style={{ color: "var(--brand)" }}>
                        {a.company.name}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
