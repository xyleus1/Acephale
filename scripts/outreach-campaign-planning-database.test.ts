import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import {
  activateCampaign,
  planOutreachCampaign,
  saveDraftCampaign,
} from "../src/lib/outreach-campaigns";

async function main() {
  assert(process.env.DATABASE_URL, "DATABASE_URL is required for the outreach planning database test.");
  const suffix = randomUUID().slice(0, 8);
  const office = await prisma.office.create({ data: { name: `Outreach planning ${suffix}` } });
  try {
    const list = await prisma.researchList.create({
      data: {
        officeId: office.id,
        slug: `wens-${suffix}`,
        name: `Wens ${suffix}`,
        fields: [
          { key: "company_name", label: "Company", type: "text" },
          { key: "country_name", label: "Country", type: "text" },
          { key: "primary_email", label: "Email", type: "text" },
        ],
      },
    });
    await prisma.researchRecord.create({
      data: {
        officeId: office.id,
        listId: list.id,
        data: {
          company_name: "Wens Test Bakery",
          country_name: "GB",
          primary_email: `wens-${suffix}@example.test`,
        },
      },
    });
    const sender = await prisma.emailAccount.create({
      data: {
        officeId: office.id,
        email: `sender-${suffix}@example.test`,
        displayName: "Wens Test",
        provider: "GMAIL_APP_PASSWORD",
        credentialSecret: "test-secret",
        isActive: true,
        sendEnabled: true,
        dailySendLimit: 30,
      },
    });
    const baseInput = {
      officeId: office.id,
      list: list.slug,
      senderAccountId: sender.id,
      subject: "Wens test",
      bodyTemplate: "Hello {{company}}. Reply STOP to opt out.",
    };
    const plan = await planOutreachCampaign(baseInput);
    assert.equal(plan.emailField, "primary_email");
    assert.equal(plan.eligible, 1);
    const draft = await saveDraftCampaign({ ...baseInput, emailField: plan.emailField });
    const originalRevisionHash = draft.revisionHash;
    await saveDraftCampaign({
      ...baseInput,
      subject: "Replanned Wens test",
      emailField: plan.emailField,
    });
    const staleActivation = await activateCampaign({
      officeId: office.id,
      campaignId: draft.id,
      userId: null,
      expectedRevisionHash: originalRevisionHash,
    });
    assert.deepEqual(staleActivation, {
      activated: false,
      blockers: ["This campaign changed after it was proposed. Plan it again."],
    });
    const replanned = await prisma.outreachCampaign.findUniqueOrThrow({
      where: { id: draft.id },
      select: { status: true, subject: true },
    });
    assert.deepEqual(replanned, { status: "DRAFT", subject: "Replanned Wens test" });

    const activeCampaignName = `Explicit Wens campaign ${suffix}`;
    const activePlan = await planOutreachCampaign({
      ...baseInput,
      campaignName: activeCampaignName,
      subject: "Active Wens test",
    });
    const activeDraft = await saveDraftCampaign({
      ...baseInput,
      campaignName: activeCampaignName,
      subject: "Active Wens test",
      emailField: activePlan.emailField,
    });
    const activated = await activateCampaign({
      officeId: office.id,
      campaignId: activeDraft.id,
      userId: null,
      expectedRevisionHash: activeDraft.revisionHash,
    });
    assert.equal(activated.activated, true);
    const afterActivation = await saveDraftCampaign({
      ...baseInput,
      campaignName: activeCampaignName,
      subject: "Fresh Wens draft",
      emailField: activePlan.emailField,
    });
    assert.notEqual(afterActivation.id, activeDraft.id);
    const rows = await prisma.outreachCampaign.findMany({
      where: { officeId: office.id, listId: list.id },
      select: { id: true, status: true, subject: true },
      orderBy: { createdAt: "asc" },
    });
    assert.deepEqual(rows.slice(-2), [
      { id: activeDraft.id, status: "ACTIVE", subject: "Active Wens test" },
      { id: afterActivation.id, status: "DRAFT", subject: "Fresh Wens draft" },
    ]);
    console.log("Outreach campaign planning database checks passed.");
  } finally {
    await prisma.office.delete({ where: { id: office.id } });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
