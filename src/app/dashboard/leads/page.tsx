import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { LEAD_PAGE_SIZE, loadLeadDirectory } from "@/lib/leads-directory";
import styles from "./leads.module.css";

export const metadata: Metadata = {
  title: { absolute: "Leads" },
};

const PRIORITIES = [
  { value: "all", label: "All" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

function pageHref(params: {
  q: string;
  source: string;
  priority: string;
  page: number;
}) {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.source) search.set("source", params.source);
  if (params.priority && params.priority !== "all") search.set("priority", params.priority);
  if (params.page > 1) search.set("page", String(params.page));
  const query = search.toString();
  return query ? `/dashboard/leads?${query}` : "/dashboard/leads";
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; source?: string; priority?: string; page?: string }>;
}) {
  const session = await requireSession();
  if (session.accessKind === "customer") redirect("/dashboard/supply-os");

  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const source = params.source?.trim() ?? "";
  const priority = params.priority?.trim().toLowerCase() ?? "all";
  const page = Number.parseInt(params.page ?? "1", 10);

  const directory = await loadLeadDirectory(session.officeId, {
    query: q,
    source,
    priority,
    page: Number.isFinite(page) ? page : 1,
  });

  const exportSearch = new URLSearchParams();
  if (q) exportSearch.set("q", q);
  if (source) exportSearch.set("source", source);
  if (priority !== "all") exportSearch.set("priority", priority);
  const exportHref = `/api/leads/export${exportSearch.toString() ? `?${exportSearch}` : ""}`;

  const rangeStart = directory.total === 0 ? 0 : (directory.page - 1) * LEAD_PAGE_SIZE + 1;
  const rangeEnd = Math.min(directory.page * LEAD_PAGE_SIZE, directory.total);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>Leads</h1>
        <p className={styles.counts}>
          <span>{directory.total} companies</span>
          <span>{directory.contactTotal} contacts with email</span>
        </p>
      </header>

      <form className={styles.filters} method="get" action="/dashboard/leads">
        <label>
          <span>Search</span>
          <input name="q" defaultValue={q} placeholder="Company, domain, city or email" />
        </label>
        <label>
          <span>Source</span>
          <select name="source" defaultValue={source}>
            <option value="">All sources</option>
            {directory.sources.map((item) => (
              <option key={item.value} value={item.value}>
                {item.value} ({item.count})
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Priority</span>
          <select name="priority" defaultValue={priority}>
            {PRIORITIES.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
        <button type="submit">Apply</button>
        <a className={styles.export} href={exportHref}>Export CSV</a>
      </form>

      {directory.rows.length === 0 ? (
        <p className={styles.empty}>No leads match this filter.</p>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Company</th>
                <th scope="col">City</th>
                <th scope="col">Fit</th>
                <th scope="col">Contacts</th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {directory.rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.name}</strong>
                    {row.website ? (
                      <a href={row.website} target="_blank" rel="noreferrer noopener">
                        {row.domain ?? row.website}
                      </a>
                    ) : null}
                    {row.segments.length ? <span className={styles.meta}>{row.segments.join(", ")}</span> : null}
                  </td>
                  <td>{row.city ?? "Unknown"}</td>
                  <td className={styles.numeric}>
                    {row.fitScore === null ? "n/a" : `${row.fitScore}`}
                    {row.fitTier ? <span className={styles.meta}>Tier {row.fitTier}</span> : null}
                  </td>
                  <td>
                    {row.contacts.length === 0 ? (
                      <span className={styles.meta}>No contact</span>
                    ) : (
                      <ul className={styles.contacts}>
                        {row.contacts.map((contact) => (
                          <li key={contact.id}>
                            <span>{contact.email ?? contact.fullName}</span>
                            <span className={styles.meta}>
                              {contact.emailVerdict ?? "unverified"}
                              {contact.emailConfidence === null ? "" : ` ${contact.emailConfidence}%`}
                              {contact.status ? ` · ${contact.status.replace(/_/g, " ")}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td>
                    <span>{row.source}</span>
                    {row.evidenceUrls[0] ? (
                      <a href={row.evidenceUrls[0]} target="_blank" rel="noreferrer noopener">Evidence</a>
                    ) : null}
                    {row.discoveredVia ? <span className={styles.meta}>{row.discoveredVia}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <nav className={styles.pager} aria-label="Pagination">
        <span className={styles.meta}>
          {rangeStart}-{rangeEnd} of {directory.total}
        </span>
        <span className={styles.pagerLinks}>
          {directory.page > 1 ? (
            <a href={pageHref({ q, source, priority, page: directory.page - 1 })}>Previous</a>
          ) : null}
          {directory.page < directory.pageCount ? (
            <a href={pageHref({ q, source, priority, page: directory.page + 1 })}>Next</a>
          ) : null}
        </span>
      </nav>
    </main>
  );
}
