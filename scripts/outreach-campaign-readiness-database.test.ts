import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { activateCampaign, campaignRevisionHashForEdit, planOutreachCampaign, resumeCampaign, saveDraftCampaign } from "../src/lib/outreach-campaigns";

async function main() {
  assert(process.env.DATABASE_URL, "DATABASE_URL is required for the outreach readiness database test.");
  const suffix = randomUUID().slice(0, 8);
  const office = await prisma.office.create({ data: { name: `Outreach readiness ${suffix}` } });
  const sender = await prisma.emailAccount.create({
    data: {
      officeId: office.id,
      email: `readiness-${suffix}@example.com`,
      provider: "GMAIL_APP_PASSWORD",
      credentialSecret: "test-secret",
      isActive: true,
      sendEnabled: true,
      dailySendLimit: 30,
    },
  });
  try {
    async function list(name: string) {
      return prisma.researchList.create({
        data: {
          officeId: office.id,
          slug: `${name}-${suffix}`,
          name,
          fields: [{ key: "email", label: "Email", type: "email" }],
        },
      });
    }
    const blockedList = await list("blocked");
    const blockedRecord = await prisma.researchRecord.create({
      data: { officeId: office.id, listId: blockedList.id, data: { email: `blocked-${suffix}@gmail.com` } },
    });
    const blockedInput = {
      officeId: office.id,
      list: blockedList.slug,
      senderAccountId: sender.id,
      emailField: "email",
      subject: "Blocked",
      bodyTemplate: "Hello {{email}}. Reply STOP to opt out.",
      replyMode: "AUTO",
      replyContext: null,
    };
    const blockedPlan = await planOutreachCampaign(blockedInput);
    const blockedDraft = await saveDraftCampaign(blockedInput);
    const blockedActivation = await activateCampaign({
      officeId: office.id,
      campaignId: blockedDraft.id,
      userId: null,
      expectedRevisionHash: blockedDraft.revisionHash,
    });
    assert.equal(blockedActivation.activated, false);
    assert(blockedActivation.blockers.includes("Auto-reply is on but the campaign has no reply context. Add pitch, offer, FAQs and limits, or set reply mode to OFF."));
    assert.equal((await prisma.outreachCampaign.findUniqueOrThrow({ where: { id: blockedDraft.id } })).status, "DRAFT");
    assert.equal(blockedPlan.warnings.length, 1);
    assert.equal(blockedRecord.officeId, office.id);

    const validList = await list("valid");
    await prisma.researchRecord.create({
      data: { officeId: office.id, listId: validList.id, data: { email: `valid-${suffix}@gmail.com` } },
    });
    const validInput = {
      ...blockedInput,
      list: validList.slug,
      subject: "Valid",
      replyContext: { pitch: "A useful offer", offer: "A quote", faqs: [], limits: [] },
    };
    const validPlan = await planOutreachCampaign(validInput);
    const validDraft = await saveDraftCampaign({ ...validInput, emailField: validPlan.emailField });
    const validRevisionHash = await campaignRevisionHashForEdit({
      officeId: office.id,
      campaignId: validDraft.id,
      subject: validInput.subject,
      bodyTemplate: validInput.bodyTemplate,
      variants: null,
      followUps: null,
    });
    await prisma.outreachCampaign.update({
      where: { id: validDraft.id },
      data: { revisionHash: validRevisionHash },
    });
    const validActivation = await activateCampaign({
      officeId: office.id,
      campaignId: validDraft.id,
      userId: null,
      expectedRevisionHash: validRevisionHash,
    });
    assert.equal(validActivation.activated, true);

    const inheritedList = await list("inherited");
    await prisma.researchRecord.create({
      data: { officeId: office.id, listId: inheritedList.id, data: { email: `inherited-${suffix}@gmail.com` } },
    });
    const { replyContext, ...withoutReplyContext } = blockedInput;
    void replyContext;
    const inheritedPlan = await planOutreachCampaign({
      ...withoutReplyContext,
      list: inheritedList.slug,
      campaignName: `Inherited ${suffix}`,
    });
    const inherited = await saveDraftCampaign({
      ...withoutReplyContext,
      list: inheritedList.slug,
      campaignName: `Inherited ${suffix}`,
      emailField: inheritedPlan.emailField,
    });
    assert.equal(inheritedPlan.revisionHash, inherited.revisionHash);
    assert.equal(inheritedPlan.replyContextInheritedFrom, inherited.replyContextInheritedFrom);
    assert.equal(inherited.replyContextInheritedFrom, validDraft.id);
    const inheritedCampaign = await prisma.outreachCampaign.findUniqueOrThrow({ where: { id: inherited.id } });
    assert.equal(inheritedCampaign.replyContext && typeof inheritedCampaign.replyContext === "object", true);

    const paused = await prisma.outreachCampaign.create({
      data: {
        officeId: office.id,
        listId: inheritedList.id,
        name: `Paused ${suffix}`,
        status: "PAUSED",
        subject: "Paused",
      bodyTemplate: "Paused. Reply STOP to opt out.",
        emailField: "email",
        rowStatuses: ["new"],
        audienceTotal: 0,
        approvedAt: new Date(),
        replyMode: "AUTO",
        replyContext: null,
      },
    });
    const resumed = await resumeCampaign({ officeId: office.id, campaignId: paused.id });
    assert.deepEqual(resumed, {
      count: 0,
      resumed: false,
      blockers: ["Auto-reply is on but the campaign has no reply context. Add pitch, offer, FAQs and limits, or set reply mode to OFF."],
    });
  } finally {
    await prisma.office.delete({ where: { id: office.id } });
  }
  await prisma.$disconnect();
  console.log("outreach readiness database checks verified");
}

void main();
