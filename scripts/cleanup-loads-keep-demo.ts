import "dotenv/config";
import { prisma } from "../src/lib/prisma";

// One-off: delete every load in an office EXCEPT the one kept as a demo.
// The RFQs (Inquiries) behind the deleted loads are kept — only the Job rows
// go. Email threads survive: EmailThread.jobId is onDelete: SetNull, and
// documents/milestones/price history/proposals/assessments cascade with the
// job. If the kept job's RFQ carries a DRY file number, the job is renamed to
// it so the demo shows the reference system loads use going forward.
//
// Usage: tsx scripts/cleanup-loads-keep-demo.ts --office=<id> --keep=<job reference> [--apply]

async function main() {
  const apply = process.argv.includes("--apply");
  const officeId = process.argv.find((a) => a.startsWith("--office="))?.slice("--office=".length);
  const keepRef = process.argv.find((a) => a.startsWith("--keep="))?.slice("--keep=".length);
  if (!officeId || !keepRef) {
    console.error("Usage: tsx scripts/cleanup-loads-keep-demo.ts --office=<id> --keep=<job reference> [--apply]");
    process.exitCode = 1;
    return;
  }

  const office = await prisma.office.findUnique({ where: { id: officeId }, select: { name: true } });
  if (!office) {
    console.error(`Office ${officeId} not found`);
    process.exitCode = 1;
    return;
  }

  const keep = await prisma.job.findFirst({
    where: { officeId, reference: keepRef },
    select: { id: true, reference: true, title: true, inquiry: { select: { reference: true } } },
  });
  if (!keep) {
    console.error(`Job with reference ${keepRef} not found in ${office.name}`);
    process.exitCode = 1;
    return;
  }

  const doomed = await prisma.job.findMany({
    where: { officeId, id: { not: keep.id } },
    select: {
      id: true,
      reference: true,
      status: true,
      origin: true,
      destination: true,
      _count: { select: { documents: true, milestones: true, emailThreads: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`${office.name}: keeping ${keep.reference} (${keep.title ?? "untitled"}), deleting ${doomed.length} loads:`);
  for (const j of doomed) {
    console.log(`  ${j.reference}  ${j.status.padEnd(10)} ${j.origin ?? "?"} → ${j.destination ?? "?"}  (docs:${j._count.documents} ms:${j._count.milestones} threads:${j._count.emailThreads})`);
  }

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to delete.");
    return;
  }

  const deleted = await prisma.job.deleteMany({ where: { id: { in: doomed.map((j) => j.id) } } });
  console.log(`Deleted ${deleted.count} loads.`);

  if (keep.inquiry?.reference && keep.inquiry.reference !== keep.reference) {
    await prisma.job.update({ where: { id: keep.id }, data: { reference: keep.inquiry.reference } });
    console.log(`Renamed kept load ${keep.reference} → ${keep.inquiry.reference} (its RFQ's file number).`);
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
