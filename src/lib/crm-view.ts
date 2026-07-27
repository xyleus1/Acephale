export type CrmView = "contacts" | "today" | "week";

export function parseCrmView(value: string | undefined): CrmView {
  if (value === "today" || value === "week") return value;
  return "contacts";
}

export function crmViewHref(view: CrmView, query = ""): string {
  const params = new URLSearchParams();
  const trimmedQuery = query.trim();

  if (trimmedQuery) params.set("q", trimmedQuery);
  if (view !== "contacts") params.set("view", view);

  const search = params.toString();
  return `/dashboard/crm${search ? `?${search}` : ""}`;
}
