import "server-only";

import { prisma as defaultPrisma } from "@/lib/prisma";
import { slugify } from "@/lib/research-lists";

export type ResearchProjectSummary = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  companyId: string | null;
  listCount: number;
};

const MAX_PROJECT_NAME_LENGTH = 160;
const MAX_PROJECT_DESCRIPTION_LENGTH = 1000;

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.replace(/\u2014/g, "-").replace(/\0/g, "").trim().slice(0, maxLength) : "";
}

function summaryFromProject(project: {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  companyId: string | null;
  _count: { lists: number };
}): ResearchProjectSummary {
  return {
    id: project.id,
    slug: project.slug,
    name: project.name,
    description: project.description,
    companyId: project.companyId,
    listCount: project._count.lists,
  };
}

export async function listResearchProjects(officeId: string): Promise<ResearchProjectSummary[]> {
  const projects = await defaultPrisma.researchProject.findMany({
    where: { officeId },
    orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      companyId: true,
      _count: { select: { lists: true } },
    },
  });
  return projects.map(summaryFromProject);
}

async function validateCompany(officeId: string, companyId: string | undefined) {
  if (!companyId) return null;
  const company = await defaultPrisma.company.findFirst({
    where: { id: companyId, officeId },
    select: { id: true },
  });
  if (!company) throw new Error("Research project company is invalid.");
  return company.id;
}

export async function createResearchProject(
  officeId: string,
  input: { name: string; slug?: string; description?: string; companyId?: string },
): Promise<ResearchProjectSummary> {
  const name = cleanText(input.name, MAX_PROJECT_NAME_LENGTH);
  if (!name) throw new Error("Project name is required.");
  const slug = slugify(input.slug || name);
  if (!slug) throw new Error("Project slug is invalid.");
  const companyId = await validateCompany(officeId, input.companyId);
  const duplicate = await defaultPrisma.researchProject.findUnique({
    where: { officeId_slug: { officeId, slug } },
    select: { id: true },
  });
  if (duplicate) throw new Error("A project with this slug already exists.");
  const project = await defaultPrisma.researchProject.create({
    data: {
      officeId,
      companyId,
      slug,
      name,
      description: cleanText(input.description, MAX_PROJECT_DESCRIPTION_LENGTH) || null,
    },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      companyId: true,
      _count: { select: { lists: true } },
    },
  });
  return summaryFromProject(project);
}

export async function ensureResearchProject(
  officeId: string,
  input: { name: string; companyId?: string },
): Promise<ResearchProjectSummary> {
  const name = cleanText(input.name, MAX_PROJECT_NAME_LENGTH);
  if (!name) throw new Error("Project name is required.");
  const slug = slugify(name);
  if (!slug) throw new Error("Project slug is invalid.");
  const existing = await defaultPrisma.researchProject.findUnique({
    where: { officeId_slug: { officeId, slug } },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      companyId: true,
      _count: { select: { lists: true } },
    },
  });
  if (existing) return summaryFromProject(existing);
  try {
    return await createResearchProject(officeId, { name, companyId: input.companyId });
  } catch (error) {
    const retry = await defaultPrisma.researchProject.findUnique({
      where: { officeId_slug: { officeId, slug } },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        companyId: true,
        _count: { select: { lists: true } },
      },
    });
    if (retry) return summaryFromProject(retry);
    throw error;
  }
}
