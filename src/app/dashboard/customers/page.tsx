import { UnifiedCrmWorkspace } from "@/components/unified-crm-workspace";

type SearchParams = Promise<{
  q?: string;
  status?: string;
  class1?: string;
  class2?: string;
  product?: string;
  lane?: string;
  page?: string;
  pageSize?: string;
  sortBy?: string;
  sortDir?: string;
  viewId?: string;
}>;

export default async function CustomersPage({ searchParams }: { searchParams: SearchParams }) {
  return <UnifiedCrmWorkspace searchParams={searchParams} />;
}
