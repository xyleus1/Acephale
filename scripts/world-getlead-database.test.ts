import "dotenv/config";
import assert from "node:assert/strict";
import { getWorldPrisma } from "../src/lib/world/client";
import { ingestGetleadContacts } from "../src/lib/world/getlead/contacts";

async function main() {
  if (!process.env.WORLD_DATABASE_URL) {
    console.log("world getlead database test skipped: WORLD_DATABASE_URL is unset");
    return;
  }
  const suffix = `getlead-${Date.now()}`;
  const domain = `${suffix}.test`;
  const emails = [`first@${domain}`, `second@${domain}`];
  const client = getWorldPrisma();
  try {
    const first = await ingestGetleadContacts({
      client,
      jobId: "job-1",
      rows: [
        {
          email: emails[0],
          full_name: "First Contact",
          title: "Director",
          company: "Getlead Factory",
          domain,
          country_code: "GB",
          email_verified_at: "2026-09-06",
        },
        {
          email: emails[1],
          full_name: "Second Contact",
          title: "Manager",
          company: "Getlead Factory",
          domain,
          country_code: "GB",
          email_verified_at: "2026-09-06",
        },
      ],
    });
    assert.equal(first.companiesLinked, 1);
    assert.equal(first.contactsCreated, 2);
    assert.equal(first.contactsUpdated, 0);
    const company = await client.worldCompany.findUnique({ where: { domain } });
    assert.ok(company);
    assert.equal(await client.worldContact.count({ where: { companyId: company.id } }), 2);

    const second = await ingestGetleadContacts({
      client,
      jobId: "job-2",
      rows: [{
        email: emails[0].toUpperCase(),
        full_name: "Updated Contact",
        title: "VP",
        company: "Getlead Factory",
        domain,
        country_code: "GB",
        email_verified_at: "2026-09-07",
      }],
    });
    assert.equal(second.companiesLinked, 1);
    assert.equal(second.contactsCreated, 0);
    assert.equal(second.contactsUpdated, 1);
    const updated = await client.worldContact.findUnique({ where: { email: emails[0] } });
    assert.equal(updated?.fullName, "Updated Contact");
    assert.equal(updated?.title, "VP");
    assert.equal(await client.worldContact.count({ where: { companyId: company.id } }), 2);
    console.log("world getlead database test passed");
  } finally {
    const company = await client.worldCompany.findUnique({ where: { domain } });
    await client.worldContact.deleteMany({ where: { email: { in: emails } } });
    await client.worldSourceRecord.deleteMany({ where: { source: "getlead", sourceRecordId: domain } });
    if (company) await client.worldCompany.delete({ where: { id: company.id } });
    await client.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
