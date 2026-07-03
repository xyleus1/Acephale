import {
  CrmCompanyDirectory,
  CrmCreateCompanyForm,
  CrmFilterBar,
  CrmLayerChips,
  CrmNotice,
  CrmPageHeader,
} from "@/components/crm/crm-components";
import { CrmTabs } from "@/components/crm/crm-tabs";
import { listCrmCompanies } from "@/lib/crm/data";
import { getCrmScope } from "@/lib/crm/session";
import {
  CRM_COMPANY_CATEGORIES,
  CRM_COMPANY_STAGES,
  CRM_PRIORITIES,
} from "@/lib/crm/types";

type SearchParams = Promise<{
  q?: string;
  category?: string;
  stage?: string;
  priority?: string;
  source?: string;
  layer?: string;
  ownerId?: string;
  notice?: string;
  error?: string;
}>;

export default async function CrmCompaniesPage({ searchParams }: { searchParams: SearchParams }) {
  const scope = await getCrmScope();
  const params = await searchParams;
  const companies = await listCrmCompanies(scope, params);

  return (
    <div className="crm-page">
      <CrmPageHeader
        title="Companies"
        subtitle="The office book (customers, carriers, brokers) and the founders' network (investors, partners, vendors)."
        actions={<CrmCreateCompanyForm returnTo="/dashboard/crm/companies" />}
      />
      <CrmTabs />
      <CrmNotice notice={params.notice} error={params.error} />
      <CrmLayerChips basePath="/dashboard/crm/companies" layer={params.layer} params={params} />
      <CrmFilterBar
        basePath="/dashboard/crm/companies"
        q={params.q}
        layer={params.layer}
        selects={[
          { name: "category", value: params.category ?? "", allLabel: "All categories", options: CRM_COMPANY_CATEGORIES },
          { name: "stage", value: params.stage ?? "", allLabel: "All stages", options: CRM_COMPANY_STAGES },
          { name: "priority", value: params.priority ?? "", allLabel: "All priority", options: CRM_PRIORITIES },
        ]}
      />
      <CrmCompanyDirectory companies={companies} />
    </div>
  );
}
