import type { PrismaClient } from "@prisma/client";
import type {
  PrismaClient as WorldPrismaClient,
  WorldCompany,
} from "../../generated/world-client";
import { classifyMailbox } from "./getlead/contacts";

export type CompanyPromotion = {
  name: string;
  domain: string | null;
  website: string | null;
  linkedinUrl: string | null;
  crmSource: "world";
  sourceRefs: {
    worldCompanyId: string;
    sources: string[];
  };
};

/** Build the main CRM company-shaped promotion payload without writing to either database. */
export function buildCompanyPromotion(world: WorldCompany): CompanyPromotion {
  const sourceRefs = world.legalIds && typeof world.legalIds === "object" && !Array.isArray(world.legalIds)
    ? Object.keys(world.legalIds as Record<string, unknown>)
    : [];
  return {
    name: world.canonicalName,
    domain: world.domain,
    website: world.website,
    linkedinUrl: world.linkedinUrl,
    crmSource: "world",
    sourceRefs: {
      worldCompanyId: world.id,
      sources: sourceRefs,
    },
  };
}

function objectValue(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function emailLocalPart(email: string) {
  return email.split("@")[0] || email;
}

export async function promoteToOffice(args: {
  appClient: PrismaClient;
  worldClient: WorldPrismaClient;
  officeId: string;
  worldCompanyId: string;
  contactIds?: string[];
  campaignTag: string;
  relationshipType?: string;
  crmCategory?: string;
}) {
  const world = await args.worldClient.worldCompany.findUnique({
    where: { id: args.worldCompanyId },
  });
  if (!world) throw new Error(`World company ${args.worldCompanyId} was not found`);

  const companyPromotion = buildCompanyPromotion(world);
  const sourceNames = companyPromotion.sourceRefs.sources;
  const existingCompany = await args.appClient.company.findFirst({
    where: {
      officeId: args.officeId,
      name: companyPromotion.name,
    },
    select: {
      id: true,
      domain: true,
      website: true,
      linkedinUrl: true,
      crmSource: true,
      crmCategory: true,
      sourceRefs: true,
      crmTags: true,
    },
  });
  const promotedAt = new Date().toISOString();
  const existingSourceRefs = objectValue(existingCompany?.sourceRefs);
  const sourceRefsSources = [
    ...stringArray(existingSourceRefs.sources),
    ...sourceNames,
  ].filter((source, index, sources) => sources.indexOf(source) === index);
  const sourceRefs = {
    ...existingSourceRefs,
    worldCompanyId: world.id,
    sources: sourceRefsSources,
    promotedAt,
  };
  const crmTags = [...stringArray(existingCompany?.crmTags), args.campaignTag]
    .filter((tag, index, tags) => tags.indexOf(tag) === index);
  const company = existingCompany
    ? await args.appClient.company.update({
      where: { id: existingCompany.id },
      data: {
        ...(existingCompany.domain === null && companyPromotion.domain !== null
          ? { domain: companyPromotion.domain }
          : {}),
        ...(existingCompany.website === null && companyPromotion.website !== null
          ? { website: companyPromotion.website }
          : {}),
        ...(existingCompany.linkedinUrl === null && companyPromotion.linkedinUrl !== null
          ? { linkedinUrl: companyPromotion.linkedinUrl }
          : {}),
        sourceRefs,
        crmTags,
      },
    })
    : await args.appClient.company.create({
      data: {
        name: companyPromotion.name,
        officeId: args.officeId,
        domain: companyPromotion.domain,
        website: companyPromotion.website,
        linkedinUrl: companyPromotion.linkedinUrl,
        crmSource: "world",
        crmCategory: args.crmCategory ?? "prospect",
        sourceRefs,
        crmTags,
      },
    });

  const contacts = await args.worldClient.worldContact.findMany({
    where: {
      companyId: world.id,
      ...(args.contactIds ? { id: { in: args.contactIds } } : {}),
    },
  });
  let contactsCreated = 0;
  let contactsUpdated = 0;
  for (const worldContact of contacts) {
    const email = worldContact.email.trim().toLowerCase();
    const fullName = worldContact.fullName?.trim() || emailLocalPart(email);
    const contactSourceRefs = {
      worldContactId: worldContact.id,
      source: worldContact.source,
      emailVerifiedAt: worldContact.verifiedAt?.toISOString() ?? null,
      mailboxClass: classifyMailbox(email, world.domain),
    };
    const existingContact = await args.appClient.contact.findFirst({
      where: {
        companyId: company.id,
        email: {
          equals: email,
          mode: "insensitive",
        },
      },
      select: {
        id: true,
        fullName: true,
        title: true,
        phone: true,
        location: true,
        sourceRefs: true,
        tags: true,
      },
    });
    const contactData = {
      companyId: company.id,
      fullName,
      title: worldContact.title,
      email,
      phone: worldContact.phone,
      location: worldContact.countryCode,
      relationshipType: args.relationshipType ?? "supplier",
      sourceRefs: contactSourceRefs,
      tags: [args.campaignTag],
    };
    if (existingContact) {
      await args.appClient.contact.update({
        where: { id: existingContact.id },
        data: {
          ...(existingContact.fullName === null && contactData.fullName
            ? { fullName: contactData.fullName }
            : {}),
          ...(existingContact.title === null && contactData.title
            ? { title: contactData.title }
            : {}),
          ...(existingContact.phone === null && contactData.phone
            ? { phone: contactData.phone }
            : {}),
          ...(existingContact.location === null && contactData.location
            ? { location: contactData.location }
            : {}),
          sourceRefs: {
            ...objectValue(existingContact.sourceRefs),
            ...contactData.sourceRefs,
          },
          tags: [
            ...stringArray(existingContact.tags),
            ...contactData.tags,
          ].filter((tag, index, tags) => tags.indexOf(tag) === index),
        },
      });
      contactsUpdated += 1;
    } else {
      await args.appClient.contact.create({ data: contactData });
      contactsCreated += 1;
    }
  }

  return {
    companyId: company.id,
    created: !existingCompany,
    contactsCreated,
    contactsUpdated,
  };
}
