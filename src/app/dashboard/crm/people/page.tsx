import {
  CrmContactForm,
  CrmFilterBar,
  CrmLayerChips,
  CrmNotice,
  CrmPageHeader,
  CrmPeopleDirectory,
} from "@/components/crm/crm-components";
import { CrmTabs } from "@/components/crm/crm-tabs";
import { listCrmCompanyOptions, listCrmContacts } from "@/lib/crm/data";
import { getCrmScope } from "@/lib/crm/session";
import { CRM_CONTACT_TYPES, CRM_LEVERAGE_LEVELS } from "@/lib/crm/types";

type SearchParams = Promise<{
  q?: string;
  type?: string;
  priority?: string;
  layer?: string;
  notice?: string;
  error?: string;
}>;

export default async function CrmPeoplePage({ searchParams }: { searchParams: SearchParams }) {
  const scope = await getCrmScope();
  const params = await searchParams;
  const [contacts, companyOptions] = await Promise.all([
    listCrmContacts(scope, params),
    listCrmCompanyOptions(scope),
  ]);

  return (
    <div className="crm-page">
      <CrmPageHeader
        title="People"
        subtitle="Operators, buyers, shippers, connectors, YC contacts, vendors, investors, and advisors."
        actions={<CrmContactForm companies={companyOptions} returnTo="/dashboard/crm/people" />}
      />
      <CrmTabs />
      <CrmNotice notice={params.notice} error={params.error} />
      <CrmLayerChips basePath="/dashboard/crm/people" layer={params.layer} params={params} />
      <CrmFilterBar
        basePath="/dashboard/crm/people"
        q={params.q}
        layer={params.layer}
        selects={[
          { name: "type", value: params.type ?? "", allLabel: "All types", options: CRM_CONTACT_TYPES },
          { name: "priority", value: params.priority ?? "", allLabel: "All leverage", options: CRM_LEVERAGE_LEVELS },
        ]}
      />
      <CrmPeopleDirectory contacts={contacts} />
    </div>
  );
}
