// Backfill CRM email touches: walk every office's EmailThreads, resolve the
// counterparty (contact email → inquiry link → job link → company domain),
// create missing EMAIL activities for the latest messages of each thread
// (deduped via Activity.sourceRefs.emailMessageId), persist thread
// companyId/contactId, and bump Company/Contact lastTouchAt.
//
// Usage:
//   npm run backfill:crm-email                 # all offices
//   npm run backfill:crm-email -- --office=ID  # one office
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { relinkThreadTouches } from "../src/lib/crm/email-touch";

const THREAD_BATCH_SIZE = 200;

function argValue(name: string) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

async function main() {
  const officeFilter = argValue("office");
  const offices = await prisma.office.findMany({
    where: officeFilter ? { id: officeFilter } : undefined,
    select: { id: true, name: true },
    orderBy: { id: "asc" },
  });
  if (offices.length === 0) {
    console.log(officeFilter ? `No office found with id ${officeFilter}` : "No offices found");
    return;
  }

  let totalScanned = 0;
  let totalResolved = 0;
  let totalCreated = 0;

  for (const office of offices) {
    let scanned = 0;
    let resolved = 0;
    let created = 0;
    let cursor: string | null = null;

    for (;;) {
      const threads: { id: string }[] = await prisma.emailThread.findMany({
        where: { officeId: office.id },
        select: { id: true },
        orderBy: { id: "asc" },
        take: THREAD_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (threads.length === 0) break;

      for (const thread of threads) {
        const result = await relinkThreadTouches(thread.id);
        scanned++;
        if (result.resolved) resolved++;
        created += result.created;
      }

      cursor = threads[threads.length - 1].id;
      if (threads.length < THREAD_BATCH_SIZE) break;
    }

    console.log(
      `office "${office.name}" (${office.id}): threads scanned=${scanned}, resolved=${resolved}, activities created=${created}`,
    );
    totalScanned += scanned;
    totalResolved += resolved;
    totalCreated += created;
  }

  console.log("──");
  console.log(
    `TOTAL: offices=${offices.length}, threads scanned=${totalScanned}, threads resolved=${totalResolved}, activities created=${totalCreated}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
