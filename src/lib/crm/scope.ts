import type { Prisma } from "@prisma/client";

export type CrmUserScope = {
  officeId: string;
  userId: string;
  canViewAll: boolean;
};

export function crmCompanyScope(scope: CrmUserScope): Prisma.CompanyWhereInput {
  return scope.canViewAll
    ? { officeId: scope.officeId }
    : { officeId: scope.officeId, owners: { some: { userId: scope.userId } } };
}
