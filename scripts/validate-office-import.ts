import "dotenv/config";
import { prisma } from "../src/lib/prisma";

type Check = { name: string; ok: boolean; detail?: string };

async function resolveOffice() {
  const officeId = process.env.TARGET_OFFICE_ID?.trim();
  const officeName = process.env.TARGET_OFFICE_NAME?.trim();
  if (!officeId && !officeName) throw new Error("Set TARGET_OFFICE_ID or TARGET_OFFICE_NAME.");
  const office = officeId
    ? await prisma.office.findUnique({ where: { id: officeId }, select: { id: true, name: true } })
    : await prisma.office.findUnique({ where: { name: officeName! }, select: { id: true, name: true } });
  if (!office) throw new Error("Target office was not found.");
  return office;
}

function pass(name: string, detail?: string): Check {
  return { name, ok: true, detail };
}

function fail(name: string, detail?: string): Check {
  return { name, ok: false, detail };
}

function printChecks(checks: Check[]) {
  for (const check of checks) {
    console.log(`${check.ok ? "OK" : "FAIL"} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`);
  }
}

async function main() {
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required.");
  const office = await resolveOffice();
  const checks: Check[] = [];

  const [
    adminCount,
    companyCount,
    contactCount,
    activeInquiryCount,
    activeJobCount,
    emailTokenCount,
    marketSignalCount,
    marketReviewCount,
    marketFeedbackCount,
    marketRunCount,
    portalTokenRows,
    orphanContacts,
    crossOfficeJobs,
    crossOfficeInquiries,
    crossOfficeActivities,
    jobDocuments,
    companyDocuments,
  ] = await Promise.all([
    prisma.user.count({ where: { officeId: office.id, role: "ADMIN", isActive: true } }),
    prisma.company.count({ where: { officeId: office.id } }),
    prisma.contact.count({ where: { company: { officeId: office.id } } }),
    prisma.inquiry.count({ where: { officeId: office.id, status: { notIn: ["WON", "LOST"] } } }),
    prisma.job.count({ where: { officeId: office.id, status: { notIn: ["DELIVERED", "CANCELLED"] } } }),
    prisma.emailAccount.count({
      where: {
        officeId: office.id,
        OR: [{ accessToken: { not: null } }, { refreshToken: { not: null } }],
      },
    }),
    prisma.marketSignal.count({ where: { officeId: office.id } }),
    prisma.marketImpactReview.count({ where: { officeId: office.id } }),
    prisma.marketSignalFeedback.count({ where: { officeId: office.id } }),
    prisma.marketIngestionRun.count({ where: { officeId: office.id } }),
    prisma.job.findMany({ where: { officeId: office.id, portalToken: { not: null } }, select: { id: true, portalToken: true } }),
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count
      FROM "Contact" ct
      LEFT JOIN "Company" c ON c."id" = ct."companyId"
      WHERE c."id" IS NULL
    `,
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count
      FROM "Job" j
      LEFT JOIN "Company" c ON c."id" = j."companyId"
      WHERE j."officeId" = ${office.id}
        AND j."companyId" IS NOT NULL
        AND (c."id" IS NULL OR c."officeId" <> ${office.id})
    `,
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count
      FROM "Inquiry" i
      LEFT JOIN "Company" c ON c."id" = i."companyId"
      WHERE i."officeId" = ${office.id}
        AND i."companyId" IS NOT NULL
        AND (c."id" IS NULL OR c."officeId" <> ${office.id})
    `,
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count
      FROM "Activity" a
      LEFT JOIN "Company" c ON c."id" = a."companyId"
      WHERE a."officeId" = ${office.id}
        AND (c."id" IS NULL OR c."officeId" <> ${office.id})
    `,
    prisma.jobDocument.findMany({
      where: { officeId: office.id },
      select: { id: true, name: true, url: true },
      take: 20,
    }),
    prisma.companyDocument.findMany({
      where: { officeId: office.id },
      select: { id: true, name: true, url: true },
      take: 20,
    }),
  ]);

  checks.push(pass("target_office_exists", `${office.name} (${office.id})`));
  checks.push(adminCount > 0 ? pass("admin_user_exists", `${adminCount} active admin user(s)`) : fail("admin_user_exists", "no active admin user"));
  checks.push(pass("company_count", String(companyCount)));
  checks.push(pass("contact_count", String(contactCount)));
  checks.push(pass("active_inquiry_count", String(activeInquiryCount)));
  checks.push(pass("active_job_count", String(activeJobCount)));
  checks.push(emailTokenCount === 0 ? pass("no_email_account_tokens_imported") : fail("no_email_account_tokens_imported", `${emailTokenCount} token-bearing account row(s)`));
  checks.push(marketSignalCount === 0 && marketReviewCount === 0 && marketFeedbackCount === 0 && marketRunCount === 0
    ? pass("no_market_intelligence_residue")
    : fail("no_market_intelligence_residue", `signals=${marketSignalCount}; reviews=${marketReviewCount}; feedback=${marketFeedbackCount}; runs=${marketRunCount}`));

  const oldPortalTokenCount = portalTokenRows.filter((row) => /^[a-f0-9]{32}$/i.test(row.portalToken ?? "")).length;
  const invalidPortalTokenCount = portalTokenRows.filter((row) => !/^[a-f0-9]{64}$/i.test(row.portalToken ?? "")).length;
  checks.push(oldPortalTokenCount === 0 ? pass("no_known_old_portal_tokens") : fail("no_known_old_portal_tokens", `${oldPortalTokenCount} old token candidate(s)`));
  checks.push(invalidPortalTokenCount === 0 ? pass("portal_tokens_use_new_64_hex_shape") : fail("portal_tokens_use_new_64_hex_shape", `${invalidPortalTokenCount} invalid token shape(s)`));
  checks.push(Number(orphanContacts[0]?.count ?? 0) === 0 ? pass("no_orphan_contacts") : fail("no_orphan_contacts", String(orphanContacts[0]?.count ?? 0)));
  checks.push(Number(crossOfficeJobs[0]?.count ?? 0) === 0 ? pass("jobs_do_not_cross_offices") : fail("jobs_do_not_cross_offices", String(crossOfficeJobs[0]?.count ?? 0)));
  checks.push(Number(crossOfficeInquiries[0]?.count ?? 0) === 0 ? pass("inquiries_do_not_cross_offices") : fail("inquiries_do_not_cross_offices", String(crossOfficeInquiries[0]?.count ?? 0)));
  checks.push(Number(crossOfficeActivities[0]?.count ?? 0) === 0 ? pass("activities_do_not_cross_offices") : fail("activities_do_not_cross_offices", String(crossOfficeActivities[0]?.count ?? 0)));

  const badJobDocs = jobDocuments.filter((doc) => doc.url && !doc.url.startsWith("metadata-only://"));
  const badCompanyDocs = companyDocuments.filter((doc) => doc.url && !doc.url.startsWith("metadata-only://"));
  checks.push(badJobDocs.length === 0 ? pass("job_documents_metadata_only") : fail("job_documents_metadata_only", `${badJobDocs.length} document URL(s) look live`));
  checks.push(badCompanyDocs.length === 0 ? pass("company_documents_metadata_only") : fail("company_documents_metadata_only", `${badCompanyDocs.length} document URL(s) look live`));

  printChecks(checks);

  const ok = checks.every((check) => check.ok);
  console.log(JSON.stringify({ ok, office, checks }, null, 2));
  if (!ok) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
