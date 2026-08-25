import "server-only";

import type { PrismaClient } from "@prisma/client";
import type { SessionPayload } from "@/lib/auth";
import {
  listSwitchableOffices,
  type SwitchableOffice,
} from "@/lib/office-switch";
import {
  listSupplyWorkspaces,
  type SupplyAccessContext,
} from "@/lib/supply-os/persistence";

export type OfficeWorkspaces = {
  officeId: string;
  officeName: string;
  isCurrent: boolean;
  workspaces: Awaited<ReturnType<typeof listSupplyWorkspaces>>;
};

type OfficeWorkspaceOptions = {
  officeClient?: Pick<PrismaClient, "user">;
  listWorkspaces?: typeof listSupplyWorkspaces;
};

async function defaultListWorkspaces(context: SupplyAccessContext) {
  return listSupplyWorkspaces(context);
}

export async function listWorkspacesAcrossOffices(
  session: SessionPayload,
  options: OfficeWorkspaceOptions = {},
): Promise<OfficeWorkspaces[]> {
  const offices = await listSwitchableOffices(session, {
    client: options.officeClient,
  });
  const loadWorkspaces = options.listWorkspaces ?? defaultListWorkspaces;

  return Promise.all(
    offices.map(async (office: SwitchableOffice) => {
      const context: SupplyAccessContext = {
        officeId: office.officeId,
        userId: office.userId,
        role: office.role,
        canViewWholeOffice: office.canViewWholeOffice,
        accessKind: "operator",
      };
      return {
        officeId: office.officeId,
        officeName: office.officeName,
        isCurrent: office.isCurrent,
        workspaces: await loadWorkspaces(context),
      };
    }),
  );
}
