import "dotenv/config";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { getWorldPrisma } from "../src/lib/world/client";
import { prisma } from "../src/lib/prisma";
import { loadSourceFile } from "../src/lib/world/load";
import { promoteToOffice } from "../src/lib/world/promote";
import { ingestGetleadContacts } from "../src/lib/world/getlead/contacts";
import {
  createGetleadClient,
  deliverCompaniesGuarded,
  deliverContactsGuarded,
  type GetleadFilters,
} from "../src/lib/world/getlead/client";
import { getGetleadContactRows, getGetleadJobId } from "../src/lib/world/getlead/raw";

type Args = Record<string, string | boolean>;
let worldClient: ReturnType<typeof getWorldPrisma> | undefined;

function parseArgs(argv: readonly string[]) {
  const [command = "help", ...rest] = argv;
  const args: Args = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token?.startsWith("--")) continue;
    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      index += 1;
    }
  }
  return { command, args };
}

function stringArg(args: Args, key: string) {
  const value = args[key];
  if (typeof value !== "string" || !value) throw new Error(`--${key} is required`);
  return value;
}

function numberArg(args: Args, key: string) {
  const value = Number(stringArg(args, key));
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${key} must be a positive integer`);
  return value;
}

async function jsonFile(path: string) {
  return JSON.parse(await readFile(path, "utf8")) as GetleadFilters;
}

function getClient() {
  return createGetleadClient({ apiKey: process.env.GETLEAD_API_KEY ?? "" });
}

function printHelp() {
  console.log(`Getlead world source CLI

  usage
  count --filters <json file>
  preview --filters <json file>
  companies --filters <json file> --limit N --max-cents N --out <jsonl>
  contacts --filters <json file> --limit N --max-cents N --out <json>
  ingest-file --file <raw job json>
  promote --office <office name or id> --campaign <tag> --emails <file> [--relationship supplier|buyer|partner]`);
}

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  if (command === "help") {
    printHelp();
    return;
  }
  const client = getClient();
  if (command === "usage") {
    console.log(JSON.stringify(await client.usage(), null, 2));
    return;
  }
  if (command === "count" || command === "preview") {
    const filters = await jsonFile(stringArg(args, "filters"));
    const result = command === "count"
      ? await client.searchCount(filters)
      : await client.searchPreview(filters);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const db = getWorldPrisma();
  worldClient = db;
  if (command === "companies") {
    const filters = await jsonFile(stringArg(args, "filters"));
    const { count, delivery } = await deliverCompaniesGuarded({
      client,
      filters,
      limit: numberArg(args, "limit"),
      maxCents: numberArg(args, "max-cents"),
    });
    const output = stringArg(args, "out");
    await appendFile(output, delivery.rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
    const load = await loadSourceFile({
      client: db,
      source: "getlead",
      filePath: output,
      batchSize: 500,
    });
    console.table([{
      command,
      available: count.companies ?? 0,
      delivered: delivery.delivered,
      chargedCents: delivery.charged_cents,
      rowsInserted: load.rowsInserted,
    }]);
    return;
  }
  if (command === "contacts") {
    const filters = await jsonFile(stringArg(args, "filters"));
    const { delivery } = await deliverContactsGuarded({
      client,
      filters,
      limit: numberArg(args, "limit"),
      maxCents: numberArg(args, "max-cents"),
    });
    const job = await client.waitForJob(delivery.job_id);
    const rows = await client.fetchJobRows(delivery.job_id);
    await writeFile(stringArg(args, "out"), JSON.stringify({
      ...job,
      job_id: delivery.job_id,
      rows,
    }, null, 2));
    const result = await ingestGetleadContacts({
      client: db,
      rows,
      jobId: delivery.job_id,
    });
    console.table([{
      command,
      jobId: delivery.job_id,
      ...result,
    }]);
    return;
  }
  if (command === "ingest-file") {
    const raw = JSON.parse(await readFile(stringArg(args, "file"), "utf8")) as unknown;
    const result = await ingestGetleadContacts({
      client: db,
      rows: getGetleadContactRows(raw),
      jobId: getGetleadJobId(raw),
    });
    console.table([result]);
    return;
  }
  if (command === "promote") {
    const officeArg = stringArg(args, "office");
    const office = await prisma.office.findFirst({
      where: { OR: [{ id: officeArg }, { name: officeArg }] },
      select: { id: true },
    });
    if (!office) throw new Error(`Office ${officeArg} was not found`);
    const emails = (await readFile(stringArg(args, "emails"), "utf8"))
      .split(/\r?\n/u)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
    const contacts = [];
    for (const email of emails) {
      const contact = await db.worldContact.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        select: { id: true, companyId: true },
      });
      if (contact) contacts.push(contact);
    }
    const grouped = new Map<string, string[]>();
    for (const contact of contacts) {
      const ids = grouped.get(contact.companyId) ?? [];
      ids.push(contact.id);
      grouped.set(contact.companyId, ids);
    }
    const results = [];
    for (const [worldCompanyId, contactIds] of grouped) {
      results.push(await promoteToOffice({
        appClient: prisma,
        worldClient: db,
        officeId: office.id,
        worldCompanyId,
        contactIds,
        campaignTag: stringArg(args, "campaign"),
        relationshipType: typeof args.relationship === "string" ? args.relationship : "supplier",
      }));
    }
    console.table(results);
    return;
  }
  printHelp();
  process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all([
      prisma.$disconnect(),
      worldClient?.$disconnect(),
    ]);
  });
