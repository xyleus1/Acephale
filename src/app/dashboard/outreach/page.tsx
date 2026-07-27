import { requireSession } from "@/lib/auth";
import { prepareOutreachWorkspace } from "@/lib/crm-outreach-plan";
import { loadCrmWorkspaceData } from "@/lib/crm-workspace";
import { parseOutreachView } from "@/lib/crm-view";
import { ContactSheet } from "@/components/contact-sheet";

export const metadata = { title: "Outreach" };

type SearchParams = Promise<{ q?: string; view?: string }>;

export default async function OutreachPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireSession();
  const { q: rawQ, view: rawView } = await searchParams;
  const q = typeof rawQ === "string" ? rawQ : "";
  const initialView = parseOutreachView(rawView);
  const now = new Date();
  const [planItems, workspace] = await Promise.all([
    prepareOutreachWorkspace(session.officeId, now),
    loadCrmWorkspaceData(session.officeId),
  ]);

  return (
    <ContactSheet
      key={`${q}:${initialView}`}
      initialRows={workspace.rows}
      companies={workspace.companies}
      initialQuery={q}
      initialPlan={planItems}
      initialView={initialView}
    />
  );
}
