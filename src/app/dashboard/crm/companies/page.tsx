import {
  CrmCompanyDirectory,
  CrmCreateCompanyForm,
  CrmFilterBar,
  CrmPageHeader,
  CrmTabs,
} from "@/components/crm/crm-components";
import { listCrmCompanies } from "@/lib/crm/data";
import { getCrmScope } from "@/lib/crm/session";

type SearchParams = Promise<{
  q?: string;
  category?: string;
  stage?: string;
  priority?: string;
  source?: string;
}>;

export default async function CrmCompaniesPage({ searchParams }: { searchParams: SearchParams }) {
  const scope = await getCrmScope();
  const params = await searchParams;
  const companies = await listCrmCompanies(scope, params);

  return (
    <div className="crm-page">
      <CrmPageHeader
        title="Companies"
        subtitle="Customers, prospects, partners, vendors, investors, advisors, and other high-leverage accounts."
        actions={<CrmCreateCompanyForm />}
      />
      <CrmTabs />
      <CrmFilterBar basePath="/dashboard/crm/companies" q={params.q} category={params.category ?? ""} stage={params.stage ?? ""} priority={params.priority ?? ""} />
      <CrmCompanyDirectory companies={companies} />
    </div>
  );
}
