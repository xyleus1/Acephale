import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { generateMorningBrief } from "../src/lib/memory/morning-brief";

function argValue(name: string) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

async function main() {
  const requestedOfficeId = argValue("office");
  let createdOfficeId: string | null = null;
  const office = requestedOfficeId
    ? await prisma.office.findUnique({ where: { id: requestedOfficeId }, select: { id: true, name: true } })
    : await prisma.office.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true, name: true } });

  const activeOffice = office ?? await prisma.office.create({
    data: { name: `morning-brief-smoke-${Date.now()}` },
    select: { id: true, name: true },
  });
  if (!office) createdOfficeId = activeOffice.id;

  try {
    const brief = await generateMorningBrief({ officeId: activeOffice.id, limit: 5 });
    const requiredKeys = [
      "urgent_customer_followups",
      "stuck_jobs",
      "unanswered_inbound_messages",
      "new_supplier_offers",
      "high_risk_strategy_assessments",
      "missing_documents",
      "upcoming_eta_etd",
      "stale_rfqs",
      "customer_risks",
      "recommended_actions",
    ];
    for (const key of requiredKeys) {
      if (!Array.isArray((brief as Record<string, unknown>)[key])) {
        throw new Error(`Morning brief key is missing or not an array: ${key}`);
      }
    }

    console.log(JSON.stringify({
      ok: true,
      office: activeOffice,
      summary: brief.summary,
      firstRecommendedAction: brief.recommended_actions[0] ?? null,
      sample: {
        urgent_customer_followups: brief.urgent_customer_followups.slice(0, 2),
        stuck_jobs: brief.stuck_jobs.slice(0, 2),
        high_risk_strategy_assessments: brief.high_risk_strategy_assessments.slice(0, 2),
      },
    }, null, 2));
  } finally {
    if (createdOfficeId) {
      await prisma.office.delete({ where: { id: createdOfficeId } }).catch(() => null);
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
