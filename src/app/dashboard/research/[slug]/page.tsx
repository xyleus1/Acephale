import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { loadResearchList, RESEARCH_STATUSES } from "@/lib/research-lists";
import { safeHttpUrl } from "@/lib/leads-directory";
import { ResearchImportPanel } from "../research-import-panel";
import { ResearchStatusControl } from "../research-status-control";
import styles from "../research.module.css";

export default async function ResearchListPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const session = await requireSession();
  if (session.accessKind === "customer") redirect("/dashboard/supply-os");
  const { slug } = await params;
  const filters = await searchParams;
  try {
    const list = await loadResearchList(session.officeId, slug, {
      query: filters.q?.slice(0, 120),
      status: filters.status?.slice(0, 40),
      page: Number.parseInt(filters.page || "1", 10) || 1,
    });
    const query = filters.q || "";
    const status = filters.status || "all";
    const href = (page: number) => {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (status !== "all") params.set("status", status);
      if (page > 1) params.set("page", String(page));
      return `/dashboard/research/${encodeURIComponent(slug)}${params.toString() ? `?${params}` : ""}`;
    };
    return (
      <main className={styles.page}>
        <header className={styles.header}>
          <div>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a className={styles.back} href="/dashboard/research">
              Research
            </a>
            <h1>{list.name}</h1>
          </div>
          <span className={styles.counts}>{list.total} records</span>
        </header>
        <form className={styles.filters} method="get">
          <label>
            <span>Search</span>
            <input name="q" defaultValue={query} placeholder="Search values" />
          </label>
          <label>
            <span>Status</span>
            <select name="status" defaultValue={status}>
              <option value="all">All</option>
              {RESEARCH_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value[0]!.toUpperCase() + value.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Apply</button>
          <a
            className={styles.export}
            href={`/api/research/${encodeURIComponent(slug)}/export${
              query || status !== "all"
                ? `?${new URLSearchParams({
                    ...(query ? { q: query } : {}),
                    ...(status !== "all" ? { status } : {}),
                  })}`
                : ""
            }`}
          >
            Export CSV
          </a>
        </form>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                {list.fields.map((field) => (
                  <th key={field.key}>{field.label}</th>
                ))}
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((row) => (
                <tr key={row.id}>
                  {list.fields.map((field) => {
                    const value = String(row.data[field.key] ?? "");
                    const safe = field.type === "url" ? safeHttpUrl(value) : null;
                    return (
                      <td key={field.key}>
                        {safe ? (
                          <a href={safe} target="_blank" rel="noreferrer noopener">
                            {value}
                          </a>
                        ) : (
                          value || <span className={styles.meta}>n/a</span>
                        )}
                      </td>
                    );
                  })}
                  <td>
                    <ResearchStatusControl slug={slug} recordId={row.id} status={row.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.rows.length === 0 ? (
          <p className={styles.empty}>No records match this filter.</p>
        ) : null}
        <nav className={styles.pager}>
          <span className={styles.meta}>
            {list.total === 0 ? 0 : (list.page - 1) * 50 + 1}-
            {Math.min(list.page * 50, list.total)} of {list.total}
          </span>
          <span className={styles.pagerLinks}>
            {list.page > 1 ? <a href={href(list.page - 1)}>Previous</a> : null}
            {list.page < list.pageCount ? <a href={href(list.page + 1)}>Next</a> : null}
          </span>
        </nav>
        <ResearchImportPanel slug={slug} fields={list.fields} />
      </main>
    );
  } catch {
    notFound();
  }
}
