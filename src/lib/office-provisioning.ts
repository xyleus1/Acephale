import { UserRole } from "@prisma/client";
import type { SessionPayload } from "@/lib/auth";
import { allowedLoginEmails, normalizeLoginEmail, isUsernameLoginEmail } from "@/lib/login-code";

export type ProvisionOfficeAdmin = {
  email: string;
  fullName: string;
  passwordHash: string;
};

export type ProvisionOfficeInput = {
  officeName: string;
  admins: ProvisionOfficeAdmin[];
  companyName?: string;
  workspaceName?: string;
  workspaceExternalKey?: string;
};

type OfficeRecord = {
  id: string;
  name: string;
  createdAt: Date;
};

type AdminRecord = {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
};

type CompanyRecord = {
  id: string;
  name: string;
};

type WorkspaceRecord = {
  id: string;
  name: string;
  companyId: string | null;
  externalKey: string | null;
};

type ProvisioningClient = {
  $transaction<T>(callback: (tx: OfficeProvisioningTransaction) => Promise<T>): Promise<T>;
};

export type OfficeProvisioningTransaction = {
  office: {
    findUnique(args: {
      where: { name: string };
      select: { id: true; name: true; createdAt: true };
    }): Promise<OfficeRecord | null>;
    create(args: {
      data: { name: string };
      select: { id: true; name: true; createdAt: true };
    }): Promise<OfficeRecord>;
  };
  user: {
    findUnique(args: {
      where: { officeId_email: { officeId: string; email: string } };
      select: { id: true; email: true; role: true; isActive: true; canViewWholeOffice: true };
    }): Promise<(AdminRecord & { canViewWholeOffice: boolean }) | null>;
    update(args: {
      where: { id: string };
      data: {
        fullName: string;
        passwordHash: string;
        role: UserRole;
        isActive: true;
        canViewWholeOffice: true;
      };
      select: { id: true; email: true; role: true; isActive: true };
    }): Promise<AdminRecord>;
    create(args: {
      data: {
        officeId: string;
        email: string;
        fullName: string;
        role: UserRole;
        isActive: true;
        canViewWholeOffice: true;
        passwordHash: string;
      };
      select: { id: true; email: true; role: true; isActive: true };
    }): Promise<AdminRecord>;
  };
  company: {
    findUnique(args: {
      where: { officeId_name: { officeId: string; name: string } };
      select: { id: true; name: true };
    }): Promise<CompanyRecord | null>;
    create(args: {
      data: {
        officeId: string;
        name: string;
        status: "IN_PROGRESS";
        crmCategory: string;
        crmStage: string;
        crmPriority: string;
        crmSource: string;
      };
      select: { id: true; name: true };
    }): Promise<CompanyRecord>;
  };
  supplyWorkspace: {
    findUnique(args: {
      where: { officeId_externalKey: { officeId: string; externalKey: string } };
      select: { id: true; name: true; companyId: true; externalKey: true };
    }): Promise<WorkspaceRecord | null>;
    update(args: {
      where: { id: string };
      data: {
        companyId: string;
        createdByUserId: string;
        name: string;
        status: "ACTIVE";
        archivedAt: null;
      };
      select: { id: true; name: true; companyId: true; externalKey: true };
    }): Promise<WorkspaceRecord>;
    create(args: {
      data: {
        officeId: string;
        companyId: string;
        createdByUserId: string;
        externalKey: string;
        name: string;
      };
      select: { id: true; name: true; companyId: true; externalKey: true };
    }): Promise<WorkspaceRecord>;
  };
  supplyWorkspaceMember: {
    upsert(args: {
      where: { workspaceId_userId: { workspaceId: string; userId: string } };
      create: {
        officeId: string;
        workspaceId: string;
        userId: string;
        role: "OWNER";
        isActive: true;
      };
      update: {
        officeId: string;
        role: "OWNER";
        isActive: true;
      };
    }): Promise<unknown>;
  };
};

export type ProvisionOfficeResult = {
  office: OfficeRecord;
  admin: AdminRecord;
  admins: AdminRecord[];
  company: CompanyRecord;
  workspace: WorkspaceRecord;
  createdOffice: boolean;
  createdAdmin: boolean;
  createdAdmins: boolean[];
  createdCompany: boolean;
  createdWorkspace: boolean;
};

export type OfficeProvisioningClient = ProvisioningClient;

export async function provisionOffice(
  client: OfficeProvisioningClient,
  input: ProvisionOfficeInput,
): Promise<ProvisionOfficeResult> {
  if (input.admins.length === 0) {
    throw new Error("At least one office admin is required.");
  }

  const officeName = input.officeName.trim();
  const companyName = input.companyName?.trim() || officeName;
  const workspaceName = input.workspaceName?.trim() || companyName;
  const workspaceExternalKey = input.workspaceExternalKey?.trim() || "production:primary";

  return client.$transaction(async (tx) => {
    const existingOffice = await tx.office.findUnique({
      where: { name: officeName },
      select: { id: true, name: true, createdAt: true },
    });
    const office = existingOffice ?? await tx.office.create({
      data: { name: officeName },
      select: { id: true, name: true, createdAt: true },
    });
    const createdOffice = !existingOffice;

    const admins: AdminRecord[] = [];
    const createdAdmins: boolean[] = [];
    for (const adminInput of input.admins) {
      const existingAdmin = await tx.user.findUnique({
        where: { officeId_email: { officeId: office.id, email: adminInput.email } },
        select: { id: true, email: true, role: true, isActive: true, canViewWholeOffice: true },
      });
      const admin = existingAdmin
        ? await tx.user.update({
            where: { id: existingAdmin.id },
            data: {
              fullName: adminInput.fullName,
              passwordHash: adminInput.passwordHash,
              role: UserRole.ADMIN,
              isActive: true,
              canViewWholeOffice: true,
            },
            select: { id: true, email: true, role: true, isActive: true },
          })
        : await tx.user.create({
            data: {
              officeId: office.id,
              email: adminInput.email,
              fullName: adminInput.fullName,
              role: UserRole.ADMIN,
              isActive: true,
              canViewWholeOffice: true,
              passwordHash: adminInput.passwordHash,
            },
            select: { id: true, email: true, role: true, isActive: true },
          });
      admins.push(admin);
      createdAdmins.push(!existingAdmin);
    }

    const existingCompany = await tx.company.findUnique({
      where: { officeId_name: { officeId: office.id, name: companyName } },
      select: { id: true, name: true },
    });
    const company = existingCompany ?? await tx.company.create({
      data: {
        officeId: office.id,
        name: companyName,
        status: "IN_PROGRESS",
        crmCategory: "customer",
        crmStage: "active",
        crmPriority: "high",
        crmSource: "production_commissioning",
      },
      select: { id: true, name: true },
    });

    const existingWorkspace = await tx.supplyWorkspace.findUnique({
      where: {
        officeId_externalKey: {
          officeId: office.id,
          externalKey: workspaceExternalKey,
        },
      },
      select: { id: true, name: true, companyId: true, externalKey: true },
    });
    const workspace = existingWorkspace
      ? await tx.supplyWorkspace.update({
          where: { id: existingWorkspace.id },
          data: {
            companyId: company.id,
            createdByUserId: admins[0].id,
            name: workspaceName,
            status: "ACTIVE",
            archivedAt: null,
          },
          select: { id: true, name: true, companyId: true, externalKey: true },
        })
      : await tx.supplyWorkspace.create({
          data: {
            officeId: office.id,
            companyId: company.id,
            createdByUserId: admins[0].id,
            externalKey: workspaceExternalKey,
            name: workspaceName,
          },
          select: { id: true, name: true, companyId: true, externalKey: true },
        });

    for (const admin of admins) {
      await tx.supplyWorkspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: workspace.id, userId: admin.id } },
        create: {
          officeId: office.id,
          workspaceId: workspace.id,
          userId: admin.id,
          role: "OWNER",
          isActive: true,
        },
        update: { officeId: office.id, role: "OWNER", isActive: true },
      });
    }

    return {
      office,
      admin: admins[0],
      admins,
      company,
      workspace,
      createdOffice,
      createdAdmin: createdAdmins.some(Boolean),
      createdAdmins,
      createdCompany: !existingCompany,
      createdWorkspace: !existingWorkspace,
    };
  });
}

export function canProvisionOffice(session: SessionPayload): boolean {
  return session.accessKind !== "customer"
    && session.role !== "CUSTOMER"
    && session.role === "ADMIN"
    && !isUsernameLoginEmail(session.email)
    && allowedLoginEmails().includes(normalizeLoginEmail(session.email));
}
