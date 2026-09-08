import "server-only";

import { prisma } from "@/lib/prisma";
import {
  companyIdentityValue,
} from "@/lib/supply-os/state-runtime/readers/selectors";
import {
  emptySupplyStateReaderResult,
  makeSupplyStateDependency,
  type SupplyStateReaderInput,
  type SupplyStateReaderResult,
} from "@/lib/supply-os/state-runtime/readers/types";

type CompanyStateReaderDependencies = {
  findCompany: typeof prisma.company.findFirst;
};

const defaultDependencies: CompanyStateReaderDependencies = {
  findCompany: (args) => prisma.company.findFirst(args),
};

export async function readCompanyState(
  input: SupplyStateReaderInput,
  dependencies: CompanyStateReaderDependencies = defaultDependencies,
): Promise<SupplyStateReaderResult> {
  const result = emptySupplyStateReaderResult();
  if (input.scope.type !== "company") return result;

  const company = await dependencies.findCompany({
    where: {
      id: input.scope.companyId,
      officeId: input.scope.officeId,
    },
    select: {
      id: true,
      name: true,
      status: true,
    },
  });
  const identity = companyIdentityValue(company);
  result.currentState.company = identity;
  result.dependencies.push(makeSupplyStateDependency({
    key: `company.identity:${input.scope.companyId}`,
    source: "APP_DB",
    entityType: "Company",
    entityRef: input.scope.companyId,
    value: identity,
    policy: "STRICT",
    reason: "Canonical company identity or lifecycle status changed.",
  }));
  result.sourceCounts.companies = company ? 1 : 0;
  if (!company) {
    result.uncertainties.push({
      kind: "canonical_company_missing",
      companyId: input.scope.companyId,
    });
  }
  return result;
}
