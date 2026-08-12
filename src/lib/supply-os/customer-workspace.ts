import "server-only";

import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SupplyCompanyResearch } from "@/lib/supply-os-case-model";
import { customerDomain, normalizeCustomerWebsite } from "./company-profile";
import type { SupplyAccessContext } from "./persistence";
import { requireSupplyWorkspace, SupplyPersistenceError } from "./persistence";

export type SupplyCustomerWorkspaceInput = {
  name: string;
  website?: string | null;
};

function normalizedName(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function contentHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function currentAdmin(context: SupplyAccessContext) {
  const user = await prisma.user.findFirst({
    where: { id: context.userId, officeId: context.officeId, isActive: true },
    select: { id: true, role: true },
  });
  if (!user) {
    throw new SupplyPersistenceError(
      "Your session no longer matches an active account. Sign out and sign in again.",
      "forbidden",
    );
  }
  if (user.role !== "ADMIN") {
    throw new SupplyPersistenceError("Only admins can create company workspaces.", "forbidden");
  }
  return user;
}

export function normalizeSupplyCustomerInput(input: SupplyCustomerWorkspaceInput) {
  const name = normalizedName(input.name);
  if (name.length < 2 || name.length > 160) {
    throw new SupplyPersistenceError("Company name must contain 2 to 160 characters.", "invalid_input");
  }
  const providedWebsite = input.website?.trim() || null;
  const website = normalizeCustomerWebsite(providedWebsite);
  if (providedWebsite && !website) {
    throw new SupplyPersistenceError("Enter a public company website.", "invalid_input");
  }
  return { name, website, domain: website ? customerDomain(website) : null };
}

async function findExistingCompany(officeId: string, name: string, domain: string | null) {
  return prisma.company.findFirst({
    where: {
      officeId,
      OR: [
        { name: { equals: name, mode: "insensitive" } },
        ...(domain ? [{ domain: { equals: domain, mode: "insensitive" as const } }] : []),
      ],
    },
    select: { id: true, name: true, website: true, domain: true },
  });
}

export async function createSupplyCustomerWorkspace(
  context: SupplyAccessContext,
  input: SupplyCustomerWorkspaceInput,
) {
  await currentAdmin(context);
  const normalized = normalizeSupplyCustomerInput(input);
  const existingCompany = await findExistingCompany(context.officeId, normalized.name, normalized.domain);

  return prisma.$transaction(async (tx) => {
    const company = existingCompany
      ? await tx.company.update({
          where: { id: existingCompany.id },
          data: {
            website: existingCompany.website || normalized.website,
            domain: existingCompany.domain || normalized.domain,
            class1: "Active",
            crmCategory: "customer",
            crmStage: "active",
          },
        })
      : await tx.company.create({
          data: {
            officeId: context.officeId,
            name: normalized.name,
            website: normalized.website,
            domain: normalized.domain,
            class1: "Active",
            crmCategory: "customer",
            crmStage: "active",
            crmSource: "supply_os",
            sourceRefs: normalized.website
              ? [{ sourceType: "official_website", url: normalized.website }]
              : undefined,
          },
        });

    let workspace = await tx.supplyWorkspace.findFirst({
      where: { officeId: context.officeId, companyId: company.id, status: "ACTIVE" },
      include: { members: true },
    });
    let created = false;
    if (!workspace) {
      workspace = await tx.supplyWorkspace.create({
        data: {
          officeId: context.officeId,
          companyId: company.id,
          createdByUserId: context.userId,
          externalKey: normalized.domain ? `company:${normalized.domain}` : null,
          name: company.name,
          members: {
            create: { officeId: context.officeId, userId: context.userId, role: "OWNER" },
          },
        },
        include: { members: true },
      });
      created = true;
    } else if (!workspace.members.some((member) => member.userId === context.userId && member.isActive)) {
      await tx.supplyWorkspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: workspace.id, userId: context.userId } },
        create: { officeId: context.officeId, workspaceId: workspace.id, userId: context.userId, role: "OWNER" },
        update: { isActive: true, role: "OWNER" },
      });
    }
    return { company, workspace, created, normalized };
  });
}

export async function storeSupplyCompanyResearch(args: {
  context: SupplyAccessContext;
  workspaceId: string;
  research: SupplyCompanyResearch;
}) {
  const hash = contentHash(args.research);
  const evidenceKey = `company-profile:${hash}`;
  const existing = await prisma.supplyEvidence.findUnique({
    where: { workspaceId_evidenceKey: { workspaceId: args.workspaceId, evidenceKey } },
    select: { id: true },
  });
  if (!existing) {
    await prisma.supplyEvidence.create({
      data: {
        officeId: args.context.officeId,
        workspaceId: args.workspaceId,
        createdByUserId: args.context.userId,
        evidenceKey,
        kind: "product_page",
        sourceType: "official_website",
        sourceUri: args.research.company.website,
        title: `${args.research.company.name.value} company profile`,
        excerpt: args.research.company.description.value.slice(0, 1_000),
        payload: args.research as unknown as Prisma.InputJsonValue,
        contentHash: hash,
        confidence: args.research.status === "verified" ? 1 : 0.7,
        observedAt: new Date(args.research.researchedAt),
      },
    });
  }

  const logoUrl = args.research.company.logoUrl;
  if (logoUrl) {
    const existingLogo = await prisma.supplyMediaAsset.findFirst({
      where: { officeId: args.context.officeId, workspaceId: args.workspaceId, kind: "company_logo", url: logoUrl },
      select: { id: true },
    });
    if (!existingLogo) {
      await prisma.supplyMediaAsset.create({
        data: {
          officeId: args.context.officeId,
          workspaceId: args.workspaceId,
          kind: "company_logo",
          url: logoUrl,
          sourceUrl: args.research.company.website,
          sourcePageUrl: args.research.company.website,
          attribution: "Official company website",
          isPrimary: true,
          capturedAt: new Date(args.research.researchedAt),
        },
      });
    }
  }
}

export async function getSupplyCompanyResearch(context: SupplyAccessContext, workspaceId: string) {
  await requireSupplyWorkspace(context, workspaceId, "view");
  return prisma.supplyEvidence.findFirst({
    where: {
      officeId: context.officeId,
      workspaceId,
      evidenceKey: { startsWith: "company-profile:" },
    },
    orderBy: { capturedAt: "desc" },
    select: { payload: true, capturedAt: true },
  });
}
