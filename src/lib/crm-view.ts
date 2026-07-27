export type CrmView = "contacts" | "today" | "week";
export type OutreachView = Exclude<CrmView, "contacts">;

export function parseCrmView(value: string | undefined): CrmView {
  if (value === "today" || value === "week") return value;
  return "contacts";
}

export function parseOutreachView(value: string | undefined): OutreachView {
  return value === "week" ? "week" : "today";
}

function withQuery(path: string, query: string, view?: OutreachView): string {
  const params = new URLSearchParams();
  const trimmedQuery = query.trim();

  if (trimmedQuery) params.set("q", trimmedQuery);
  if (view === "week") params.set("view", view);

  const search = params.toString();
  return `${path}${search ? `?${search}` : ""}`;
}

export function crmContactsHref(query = ""): string {
  return withQuery("/dashboard/crm", query);
}

export function outreachViewHref(view: OutreachView, query = ""): string {
  return withQuery("/dashboard/outreach", query, view);
}
