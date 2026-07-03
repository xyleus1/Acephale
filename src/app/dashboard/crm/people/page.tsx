import {
  CrmFilterBar,
  CrmPageHeader,
  CrmPeopleDirectory,
  CrmTabs,
} from "@/components/crm/crm-components";
import { listCrmContacts } from "@/lib/crm/data";
import { getCrmScope } from "@/lib/crm/session";

type SearchParams = Promise<{
  q?: string;
  type?: string;
  priority?: string;
}>;

export default async function CrmPeoplePage({ searchParams }: { searchParams: SearchParams }) {
  const scope = await getCrmScope();
  const params = await searchParams;
  const contacts = await listCrmContacts(scope, params);

  return (
    <div className="crm-page">
      <CrmPageHeader
        title="People"
        subtitle="Operators, buyers, shippers, connectors, YC contacts, vendors, investors, and advisors."
      />
      <CrmTabs />
      <CrmFilterBar basePath="/dashboard/crm/people" q={params.q} type={params.type ?? ""} priority={params.priority ?? ""} />
      <CrmPeopleDirectory contacts={contacts} />
    </div>
  );
}
