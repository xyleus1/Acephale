import type { Route } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { loadCrmWorkspaceData } from "@/lib/crm-workspace";
import { outreachViewHref } from "@/lib/crm-view";
import { ContactSheet } from "@/components/contact-sheet";

export const metadata = { title: "CRM" };

type SearchParams = Promise<{ q?: string; view?: string }>;

export default async function CrmPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession();
  const { q: rawQ, view: rawView } = await searchParams;
  const q = typeof rawQ === "string" ? rawQ : "";
  if (rawView === "today" || rawView === "week") {
    redirect(outreachViewHref(rawView, q) as Route);
  }
  const { rows, companies } = await loadCrmWorkspaceData(session.officeId);

  return (
    // Keyed by the query: ContactSheet seeds its filter from initialQuery once,
    // so a same-route ?q= navigation (⌘K company/contact pick while already on
    // the CRM) must remount it to actually apply the new search.
    <ContactSheet
      key={q}
      initialRows={rows}
      companies={companies}
      initialQuery={q}
      initialPlan={[]}
      initialView="contacts"
    />
  );
}
