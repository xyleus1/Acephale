import {
  CrmFilterBar,
  CrmLayerChips,
  CrmNotice,
  CrmOpportunityDirectory,
  CrmOpportunityForm,
  CrmPageHeader,
} from "@/components/crm/crm-components";
import { CrmTabs } from "@/components/crm/crm-tabs";
import { listCrmCompanyOptions, listCrmOpportunities } from "@/lib/crm/data";
import { getCrmScope } from "@/lib/crm/session";
import {
  CRM_OPPORTUNITY_STAGES,
  CRM_OPPORTUNITY_TYPES,
  CRM_PRIORITIES,
} from "@/lib/crm/types";

type SearchParams = Promise<{
  q?: string;
  type?: string;
  stage?: string;
  priority?: string;
  layer?: string;
  notice?: string;
  error?: string;
}>;

export default async function CrmOpportunitiesPage({ searchParams }: { searchParams: SearchParams }) {
  const scope = await getCrmScope();
  const params = await searchParams;
  const [opportunities, companyOptions] = await Promise.all([
    listCrmOpportunities(scope, params),
    listCrmCompanyOptions(scope),
  ]);

  return (
    <div className="crm-page">
      <CrmPageHeader
        title="Opportunities"
        subtitle="RFQ-linked leads plus strategic customer, partner, vendor, investor, and advisor opportunities."
        actions={<CrmOpportunityForm companies={companyOptions} returnTo="/dashboard/crm/opportunities" />}
      />
      <CrmTabs />
      <CrmNotice notice={params.notice} error={params.error} />
      <CrmLayerChips basePath="/dashboard/crm/opportunities" layer={params.layer} params={params} />
      <CrmFilterBar
        basePath="/dashboard/crm/opportunities"
        q={params.q}
        layer={params.layer}
        selects={[
          { name: "type", value: params.type ?? "", allLabel: "All types", options: CRM_OPPORTUNITY_TYPES },
          { name: "stage", value: params.stage ?? "", allLabel: "All stages", options: CRM_OPPORTUNITY_STAGES },
          { name: "priority", value: params.priority ?? "", allLabel: "All priority", options: CRM_PRIORITIES },
        ]}
      />
      <CrmOpportunityDirectory opportunities={opportunities} />
    </div>
  );
}
