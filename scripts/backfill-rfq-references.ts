import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { fileReferencePrefix } from "../src/lib/references";

// Assign DRY file numbers (DRY + YYMM + NNNN) to every Inquiry that doesn't
// have one yet, per office, ordered by receivedAt so numbers follow arrival
// order. The YYMM comes from each inquiry's receivedAt month, so April RFQs
// get DRY2604xxxx. Idempotent: only touches reference = NULL rows, and seeds
// each month's counter from the max already present on inquiries AND jobs
// (the two share one sequence).
//
// Usage: tsx scripts/backfill-rfq-references.ts [--apply] [--office=<id>]

async function seedCounter(officeId: string, prefix: string): Promise<number> {
  const [inquiries, jobs] = await Promise.all([
    prisma.inquiry.findMany({
      where: { officeId, reference: { startsWith: prefix } },
      select: { reference: true },
    }),
    prisma.job.findMany({
      where: { officeId, reference: { startsWith: prefix } },
      select: { reference: true },
    }),
  ]);
  let max = 0;
  for (const row of [...inquiries, ...jobs]) {
    const n = parseInt((row.reference ?? "").slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const officeArg = process.argv.find((a) => a.startsWith("--office="))?.slice("--office=".length);

  const offices = await prisma.office.findMany({
    where: officeArg ? { id: officeArg } : {},
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });

  for (const office of offices) {
    const missing = await prisma.inquiry.findMany({
      where: { officeId: office.id, reference: null },
      select: { id: true, subject: true, receivedAt: true },
      orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }],
    });
    if (missing.length === 0) {
      console.log(`${office.name} (${office.id}): nothing to backfill`);
      continue;
    }

    console.log(`${office.name} (${office.id}): ${missing.length} inquiries without a reference`);
    const counters = new Map<string, number>();
    for (const inq of missing) {
      const prefix = fileReferencePrefix(inq.receivedAt);
      if (!counters.has(prefix)) counters.set(prefix, await seedCounter(office.id, prefix));
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      const reference = `${prefix}${String(next).padStart(4, "0")}`;

      console.log(`  ${reference}  ${inq.receivedAt.toISOString().slice(0, 10)}  ${inq.subject.slice(0, 60)}`);
      if (apply) {
        await prisma.inquiry.update({ where: { id: inq.id }, data: { reference } });
      }
    }
  }

  if (!apply) console.log("\nDry run. Re-run with --apply to write the references.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
