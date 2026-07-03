import {
  CrmFilterBar,
  CrmOpportunityDirectory,
  CrmPageHeader,
  CrmTabs,
} from "@/components/crm/crm-components";
import { listCrmOpportunities } from "@/lib/crm/data";
import { getCrmScope } from "@/lib/crm/session";

type SearchParams = Promise<{
  q?: string;
  type?: string;
  stage?: string;
  priority?: string;
}>;

export default async function CrmOpportunitiesPage({ searchParams }: { searchParams: SearchParams }) {
  const scope = await getCrmScope();
  const params = await searchParams;
  const opportunities = await listCrmOpportunities(scope, params);

  return (
    <div className="crm-page">
      <CrmPageHeader
        title="Opportunities"
        subtitle="RFQ-linked leads plus strategic customer, partner, vendor, investor, and advisor opportunities."
      />
      <CrmTabs />
      <CrmFilterBar basePath="/dashboard/crm/opportunities" q={params.q} type={params.type ?? ""} stage={params.stage ?? ""} priority={params.priority ?? ""} />
      <CrmOpportunityDirectory opportunities={opportunities} />
    </div>
  );
}
