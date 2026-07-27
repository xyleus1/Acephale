// Database smoke test for the office-scoped weekly outreach planner.
// Run against a disposable database with:
// NODE_OPTIONS='--conditions=react-server' npx tsx scripts/crm-outreach-db.test.ts

import { prisma } from "../src/lib/prisma";
import {
  ensureOutreachPlan,
  loadOutreachPlanRows,
} from "../src/lib/crm-outreach-plan";
import { buildOutreachReport } from "../src/lib/crm-outreach";

let failures = 0;

function check(name: string, ok: boolean) {
  if (ok) {
    console.log(`ok - ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL - ${name}`);
  }
}

const now = new Date("2026-07-29T18:00:00.000Z");
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

async function main() {
  const office = await prisma.office.create({
    data: { name: `CRM outreach smoke ${suffix}` },
    select: { id: true },
  });

  try {
    const company = await prisma.company.create({
      data: {
        officeId: office.id,
        name: `Outreach candidates ${suffix}`,
      },
      select: { id: true },
    });

    const critical = await prisma.contact.create({
      data: {
        companyId: company.id,
        fullName: "Critical YC founder",
        status: "not_contacted",
        importance: "critical",
        category: "startup",
        relationshipType: "founder",
        outreachChannel: "bookface",
        bookfaceUrl: "https://bookface.ycombinator.com/test",
      },
      select: { id: true },
    });

    await prisma.contact.createMany({
      data: [
        ...Array.from({ length: 24 }, (_, index) => ({
          companyId: company.id,
          fullName: `Bookface founder ${index + 1}`,
          status: "not_contacted",
          importance: "medium",
          category: "startup",
          relationshipType: "founder",
          outreachChannel: "bookface",
          bookfaceUrl: `https://bookface.ycombinator.com/test-${index + 1}`,
        })),
        ...Array.from({ length: 35 }, (_, index) => ({
          companyId: company.id,
          fullName: `LinkedIn contact ${index + 1}`,
          status: "not_contacted",
          importance: index < 2 ? "high" : "medium",
          category: "personally_important",
          relationshipType: "industry_advisor",
          outreachChannel: "linkedin",
          linkedinUrl: `https://linkedin.com/in/test-${index + 1}`,
        })),
        ...Array.from({ length: 35 }, (_, index) => ({
          companyId: company.id,
          fullName: `Email lead ${index + 1}`,
          status: "not_contacted",
          importance: "medium",
          category: "startup",
          relationshipType: "founder",
          outreachChannel: "email",
          email: `lead-${index + 1}@example.com`,
        })),
        ...Array.from({ length: 10 }, (_, index) => ({
          companyId: company.id,
          fullName: `Forwarder data ${index + 1}`,
          status: "not_contacted",
          importance: "high",
          category: "forwarder",
          relationshipType: "buyer",
          outreachChannel: "email",
          email: `forwarder-${index + 1}@example.com`,
        })),
      ],
    });

    await ensureOutreachPlan(office.id, now);
    const firstRows = await loadOutreachPlanRows(office.id, now);
    const firstReport = buildOutreachReport(firstRows, now);

    check("planner fills all 25 eligible Bookface contacts", firstReport.channels[0].weeklyPlanned === 25);
    check("planner fills all 35 eligible LinkedIn contacts", firstReport.channels[1].weeklyPlanned === 35);
    check("planner fills all 35 eligible email contacts", firstReport.channels[2].weeklyPlanned === 35);
    check("planner promotes the full daily capacity", firstReport.dueNow === 80);
    check(
      "critical contact is promoted before normal contacts",
      firstRows.some((item) => item.contactId === critical.id && item.status === "TODAY"),
    );

    const forwarderPlanCount = await prisma.outreachPlanItem.count({
      where: {
        officeId: office.id,
        contact: { category: "forwarder" },
      },
    });
    check("forwarders remain data-only", forwarderPlanCount === 0);

    const beforeRepeat = await prisma.outreachPlanItem.count({
      where: { officeId: office.id },
    });
    await ensureOutreachPlan(office.id, now);
    const afterRepeat = await prisma.outreachPlanItem.count({
      where: { officeId: office.id },
    });
    check("repeated planning is idempotent", beforeRepeat === afterRepeat);

    const deferred = firstRows.find(
      (item) =>
        item.channel === "bookface" &&
        item.status === "TODAY" &&
        item.contactId !== critical.id,
    );
    if (!deferred) throw new Error("Expected a deferrable Bookface item in today's queue.");
    await prisma.outreachPlanItem.update({
      where: { id: deferred.id },
      data: {
        status: "WEEKLY",
        scheduledFor: new Date("2026-07-30T00:00:00.000Z"),
      },
    });
    await ensureOutreachPlan(office.id, now);
    const afterDeferralRows = await loadOutreachPlanRows(office.id, now);
    const deferredAfterRefresh = afterDeferralRows.find((item) => item.id === deferred.id);
    const afterDeferralReport = buildOutreachReport(afterDeferralRows, now);
    check(
      "deferred contact stays out of today's queue",
      deferredAfterRefresh?.status === "WEEKLY" &&
        deferredAfterRefresh.scheduledForKey === "2026-07-30",
    );
    check(
      "deferral promotes a different contact within daily capacity",
      afterDeferralReport.channels[0].dueNow === 20,
    );

    const completed = afterDeferralRows.find(
      (item) => item.channel === "bookface" && item.status === "TODAY",
    );
    if (!completed) throw new Error("Expected a Bookface item in today's queue.");
    await prisma.$transaction([
      prisma.outreachPlanItem.update({
        where: { id: completed.id },
        data: { status: "REACHED_OUT", reachedOutAt: now },
      }),
      prisma.contact.update({
        where: { id: completed.contactId },
        data: { status: "reached_out", lastTouchAt: now },
      }),
    ]);

    await ensureOutreachPlan(office.id, now);
    const afterCompletionRows = await loadOutreachPlanRows(office.id, now);
    const afterCompletionReport = buildOutreachReport(afterCompletionRows, now);
    const bookface = afterCompletionReport.channels[0];
    check("completion appears in today's report", bookface.today.reached === 1);
    check("completion does not cause an extra daily promotion", bookface.dueNow === 19);
  } finally {
    await prisma.office.delete({ where: { id: office.id } });
  }

  if (failures > 0) {
    throw new Error(`${failures} database check(s) failed`);
  }
  console.log("crm-outreach-db.test.ts passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
