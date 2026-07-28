import { prisma } from "../src/lib/prisma";
import {
  HARDWARE_VC_CAMPAIGN_TAG,
  HARDWARE_VC_OUTREACH_CAMPAIGN,
} from "../src/lib/hardware-vc-outreach-campaign";
import { loadHardwareVcOutreachCampaign } from "../src/lib/load-hardware-vc-outreach";

type CompanyState = {
  id: string;
  officeId: string;
  name: string;
  website: string | null;
  crmTags: unknown;
  sourceRefs: unknown;
  crmCategory?: string;
  crmStage?: string;
  crmPriority?: string;
};

type ContactState = {
  id: string;
  companyId: string;
  fullName: string;
  title: string | null;
  status: string | null;
  email: string | null;
  linkedinUrl: string | null;
  bookfaceUrl: string | null;
  phone: string | null;
  notes: string | null;
  ownerLabel: string | null;
  tags: unknown;
  sourceRefs: unknown;
  importance?: string;
  category?: string;
  relationshipType?: string;
  leverageLevel?: string;
  outreachChannel?: string | null;
  createdAt: Date;
};

type PlanState = {
  id: string;
  officeId: string;
  contactId: string;
  weekStart: Date;
  channel: string;
  status: string;
  scheduledFor: Date | null;
};

type DatabaseState = {
  companies: CompanyState[];
  contacts: ContactState[];
  plans: PlanState[];
  advisoryLocks: string[];
  tableLocks: number;
  nextId: number;
};

const OFFICE_ID = "office-hardware-vc-test";
const NOW = new Date("2026-07-27T18:00:00.000Z");
let failures = 0;

function check(name: string, ok: boolean) {
  if (ok) {
    console.log(`ok - ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL - ${name}`);
  }
}

function nextId(state: DatabaseState, prefix: string): string {
  state.nextId += 1;
  return `${prefix}-${state.nextId}`;
}

function initialState(): DatabaseState {
  return {
    companies: [],
    contacts: [],
    plans: [],
    advisoryLocks: [],
    tableLocks: 0,
    nextId: 0,
  };
}

function cloneState(state: DatabaseState): DatabaseState {
  return structuredClone(state);
}

function createFakePrisma(initial: DatabaseState) {
  let state = cloneState(initial);

  const tx = {
    $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = strings.join("?");
      state.advisoryLocks.push(`${sql}:${values.join(":")}`);
      if (sql.includes("pg_advisory_xact_lock") && !sql.includes("::text")) {
        throw new Error("Failed to deserialize column of type 'void'.");
      }
      return Promise.resolve([{ advisory_lock: "" }]);
    },
    $executeRaw() {
      state.tableLocks += 1;
      return Promise.resolve(0);
    },
    company: {
      findMany({ where }: { where: { officeId: string; name: { in: string[] } } }) {
        return Promise.resolve(
          state.companies.filter(
            (company) =>
              company.officeId === where.officeId &&
              where.name.in.includes(company.name),
          ),
        );
      },
      createMany({ data }: { data: Array<Record<string, unknown>> }) {
        for (const row of data) {
          if (
            state.companies.some(
              (company) =>
                company.officeId === row.officeId &&
                company.name === row.name,
            )
          ) {
            continue;
          }
          state.companies.push({
            id: nextId(state, "company"),
            officeId: String(row.officeId),
            name: String(row.name),
            website: typeof row.website === "string" ? row.website : null,
            crmTags: row.crmTags ?? null,
            sourceRefs: row.sourceRefs ?? null,
            crmCategory: typeof row.crmCategory === "string" ? row.crmCategory : undefined,
            crmStage: typeof row.crmStage === "string" ? row.crmStage : undefined,
            crmPriority: typeof row.crmPriority === "string" ? row.crmPriority : undefined,
          });
        }
        return Promise.resolve({ count: data.length });
      },
      updateMany({
        where,
        data,
      }: {
        where: { id: string; officeId: string };
        data: Record<string, unknown>;
      }) {
        const company = state.companies.find(
          (candidate) =>
            candidate.id === where.id &&
            candidate.officeId === where.officeId,
        );
        if (!company) return Promise.resolve({ count: 0 });
        Object.assign(company, data);
        return Promise.resolve({ count: 1 });
      },
    },
    contact: {
      findMany({
        where,
      }: {
        where: {
          companyId: { in: string[] };
          fullName: { in: string[]; mode?: string };
          company: { officeId: string };
        };
      }) {
        const officeCompanyIds = new Set(
          state.companies
            .filter((company) => company.officeId === where.company.officeId)
            .map((company) => company.id),
        );
        return Promise.resolve(
          state.contacts.filter(
            (contact) =>
              officeCompanyIds.has(contact.companyId) &&
              where.companyId.in.includes(contact.companyId) &&
              where.fullName.in.some(
                (name) =>
                  name.toLowerCase() === contact.fullName.toLowerCase(),
              ),
          ),
        );
      },
      createMany({ data }: { data: Array<Record<string, unknown>> }) {
        for (const row of data) {
          state.contacts.push({
            id: nextId(state, "contact"),
            companyId: String(row.companyId),
            fullName: String(row.fullName),
            title: typeof row.title === "string" ? row.title : null,
            status: typeof row.status === "string" ? row.status : null,
            email: typeof row.email === "string" ? row.email : null,
            linkedinUrl: typeof row.linkedinUrl === "string" ? row.linkedinUrl : null,
            bookfaceUrl: typeof row.bookfaceUrl === "string" ? row.bookfaceUrl : null,
            phone: typeof row.phone === "string" ? row.phone : null,
            notes: typeof row.notes === "string" ? row.notes : null,
            ownerLabel: typeof row.ownerLabel === "string" ? row.ownerLabel : null,
            tags: row.tags ?? null,
            sourceRefs: row.sourceRefs ?? null,
            importance: typeof row.importance === "string" ? row.importance : undefined,
            category: typeof row.category === "string" ? row.category : undefined,
            relationshipType:
              typeof row.relationshipType === "string" ? row.relationshipType : undefined,
            leverageLevel:
              typeof row.leverageLevel === "string" ? row.leverageLevel : undefined,
            outreachChannel:
              typeof row.outreachChannel === "string" ? row.outreachChannel : null,
            createdAt: new Date("2026-07-27T00:00:00.000Z"),
          });
        }
        return Promise.resolve({ count: data.length });
      },
      updateMany({
        where,
        data,
      }: {
        where: { id: string; company: { officeId: string } };
        data: Record<string, unknown>;
      }) {
        const contact = state.contacts.find((candidate) => candidate.id === where.id);
        const company = contact
          ? state.companies.find((candidate) => candidate.id === contact.companyId)
          : null;
        if (!contact || company?.officeId !== where.company.officeId) {
          return Promise.resolve({ count: 0 });
        }
        Object.assign(contact, data);
        return Promise.resolve({ count: 1 });
      },
    },
    outreachPlanItem: {
      findMany({
        where,
      }: {
        where: {
          officeId: string;
          weekStart?: Date;
          contactId: { in: string[] };
          status?: string;
        };
      }) {
        return Promise.resolve(
          state.plans.filter(
            (plan) =>
              plan.officeId === where.officeId &&
              where.contactId.in.includes(plan.contactId) &&
              (!where.weekStart ||
                plan.weekStart.toISOString() === where.weekStart.toISOString()) &&
              (!where.status || plan.status === where.status),
          ),
        );
      },
      createMany({ data }: { data: Array<Record<string, unknown>> }) {
        for (const row of data) {
          state.plans.push({
            id: nextId(state, "plan"),
            officeId: String(row.officeId),
            contactId: String(row.contactId),
            weekStart: row.weekStart as Date,
            channel: String(row.channel),
            status: String(row.status),
            scheduledFor: (row.scheduledFor as Date | null) ?? null,
          });
        }
        return Promise.resolve({ count: data.length });
      },
      updateMany({
        where,
        data,
      }: {
        where: {
          officeId: string;
          weekStart?: Date;
          contactId?: { in: string[] };
          status?: string | { in: string[] };
        };
        data: Record<string, unknown>;
      }) {
        let count = 0;
        for (const plan of state.plans) {
          const statusMatches =
            typeof where.status === "string"
              ? plan.status === where.status
              : where.status
                ? where.status.in.includes(plan.status)
                : true;
          const matches =
            plan.officeId === where.officeId &&
            statusMatches &&
            (!where.weekStart ||
              plan.weekStart.toISOString() === where.weekStart.toISOString()) &&
            (!where.contactId || where.contactId.in.includes(plan.contactId));
          if (!matches) continue;
          Object.assign(plan, data);
          count += 1;
        }
        return Promise.resolve({ count });
      },
    },
  };

  return {
    getState: () => cloneState(state),
    transaction: async <T>(
      callback: (client: typeof tx) => Promise<T>,
    ): Promise<T> => {
      const snapshot = cloneState(state);
      try {
        return await callback(tx);
      } catch (error) {
        state = snapshot;
        throw error;
      }
    },
  };
}

async function withFakePrisma(
  seed: DatabaseState,
  run: (fake: ReturnType<typeof createFakePrisma>) => Promise<void>,
) {
  const fake = createFakePrisma(seed);
  const originalTransaction = prisma.$transaction;
  Object.assign(prisma, {
    $transaction: fake.transaction,
  });
  try {
    await run(fake);
  } finally {
    Object.assign(prisma, {
      $transaction: originalTransaction,
    });
  }
}

function channelCounts(state: DatabaseState): Record<string, number> {
  return state.plans
    .filter((plan) => plan.officeId === OFFICE_ID && plan.status === "TODAY")
    .reduce<Record<string, number>>((counts, plan) => {
      counts[plan.channel] = (counts[plan.channel] ?? 0) + 1;
      return counts;
    }, {});
}

async function testFreshLoadAndIdempotentRerun() {
  await withFakePrisma(initialState(), async (fake) => {
    const first = await loadHardwareVcOutreachCampaign(OFFICE_ID, NOW);
    const afterFirst = fake.getState();
    check("fresh load creates all 112 contacts", first.createdContacts === 112);
    check("fresh load creates one contact per target", afterFirst.contacts.length === 112);
    check(
      "fresh load creates one company per organization",
      afterFirst.companies.length ===
        new Set(HARDWARE_VC_OUTREACH_CAMPAIGN.map((target) => target.company)).size,
    );
    check(
      "fresh load creates the exact Today channel split",
      JSON.stringify(channelCounts(afterFirst)) ===
        JSON.stringify({ bookface: 20, linkedin: 30, email: 62 }),
    );
    check(
      "email targets do not store guessed email addresses",
      afterFirst.contacts
        .filter((contact) => contact.outreachChannel === "email")
        .every((contact) => contact.email === null && contact.linkedinUrl?.includes("linkedin.com")),
    );
    check(
      "company channels become startup buyer leads",
      afterFirst.contacts
        .filter((contact) => contact.outreachChannel !== "email")
        .every(
          (contact) =>
            contact.category === "startup" &&
            contact.relationshipType === "buyer",
        ),
    );
    check(
      "email channel becomes personally important investor outreach",
      afterFirst.contacts
        .filter((contact) => contact.outreachChannel === "email")
        .every(
          (contact) =>
            contact.category === "personally_important" &&
            contact.relationshipType === "investor",
        ),
    );
    check("transaction takes a per-office advisory lock", afterFirst.advisoryLocks.length === 1);
    check(
      "advisory lock casts PostgreSQL void before Prisma deserialization",
      afterFirst.advisoryLocks[0]?.includes("::text") === true,
    );
    check("transaction locks company and contact writes", afterFirst.tableLocks === 1);

    const second = await loadHardwareVcOutreachCampaign(OFFICE_ID, NOW);
    const afterSecond = fake.getState();
    check("rerun reuses all 112 contacts", second.createdContacts === 0 && second.reusedContacts === 112);
    check("rerun does not duplicate contacts", afterSecond.contacts.length === 112);
    check("rerun does not duplicate plan rows", afterSecond.plans.length === 112);
    check(
      "rerun does not duplicate campaign notes",
      afterSecond.contacts.every(
        (contact) => contact.notes?.split(`Campaign: ${HARDWARE_VC_CAMPAIGN_TAG}.`).length === 2,
      ),
    );
  });
}

async function testExistingContactPreservationAndQueueReplacement() {
  const seed = initialState();
  seed.companies.push({
    id: "existing-company",
    officeId: OFFICE_ID,
    name: "Astranis",
    website: "https://existing.example/",
    crmTags: ["existing_tag"],
    sourceRefs: { importedFrom: "crm" },
  });
  seed.contacts.push({
    id: "existing-contact",
    companyId: "existing-company",
    fullName: "john gedmark",
    title: null,
    status: "not_contacted",
    email: "verified@example.com",
    linkedinUrl: "https://linkedin.com/in/verified",
    bookfaceUrl: null,
    phone: "+1 555 0100",
    notes: "Existing relationship note.",
    ownerLabel: "Existing owner",
    tags: ["existing_contact_tag"],
    sourceRefs: { importedFrom: "crm" },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  seed.companies.push({
    id: "old-company",
    officeId: OFFICE_ID,
    name: "Old queue company",
    website: null,
    crmTags: null,
    sourceRefs: null,
  });
  seed.contacts.push({
    id: "old-contact",
    companyId: "old-company",
    fullName: "Old queue contact",
    title: null,
    status: "queued",
    email: null,
    linkedinUrl: null,
    bookfaceUrl: null,
    phone: null,
    notes: null,
    ownerLabel: null,
    tags: null,
    sourceRefs: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  seed.plans.push({
    id: "old-plan",
    officeId: OFFICE_ID,
    contactId: "old-contact",
    weekStart: new Date("2026-07-27T00:00:00.000Z"),
    channel: "email",
    status: "TODAY",
    scheduledFor: new Date("2026-07-27T00:00:00.000Z"),
  });

  await withFakePrisma(seed, async (fake) => {
    const result = await loadHardwareVcOutreachCampaign(OFFICE_ID, NOW);
    const state = fake.getState();
    const existing = state.contacts.find((contact) => contact.id === "existing-contact");
    const oldPlan = state.plans.find((plan) => plan.id === "old-plan");
    check("loader reuses a matching CRM person", result.reusedContacts === 1);
    check(
      "loader preserves verified existing contact details",
      existing?.email === "verified@example.com" &&
        existing.linkedinUrl === "https://linkedin.com/in/verified" &&
        existing.phone === "+1 555 0100",
    );
    check(
      "loader preserves existing notes, tags, and source provenance",
      Boolean(existing?.notes?.includes("Existing relationship note.")) &&
        Array.isArray(existing?.tags) &&
        existing.tags.includes("existing_contact_tag") &&
        typeof existing.sourceRefs === "object" &&
        existing.sourceRefs !== null &&
        "importedFrom" in existing.sourceRefs,
    );
    check(
      "loader moves the previous open Today row back to weekly",
      oldPlan?.status === "WEEKLY" && oldPlan.scheduledFor === null,
    );
  });
}

async function testForeignOfficeIsolation() {
  const seed = initialState();
  seed.companies.push({
    id: "foreign-yc",
    officeId: "office-foreign",
    name: "Astranis",
    website: "https://foreign.example/",
    crmTags: ["foreign_company_tag"],
    sourceRefs: { importedFrom: "foreign-office" },
  });
  seed.contacts.push({
    id: "foreign-garry",
    companyId: "foreign-yc",
    fullName: "John Gedmark",
    title: "Foreign office title",
    status: "queued",
    email: "foreign@example.com",
    linkedinUrl: null,
    bookfaceUrl: null,
    phone: null,
    notes: "Foreign office note.",
    ownerLabel: "Foreign owner",
    tags: ["foreign_contact_tag"],
    sourceRefs: { importedFrom: "foreign-office" },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  seed.plans.push({
    id: "foreign-plan",
    officeId: "office-foreign",
    contactId: "foreign-garry",
    weekStart: new Date("2026-07-27T00:00:00.000Z"),
    channel: "email",
    status: "TODAY",
    scheduledFor: new Date("2026-07-27T00:00:00.000Z"),
  });

  await withFakePrisma(seed, async (fake) => {
    await loadHardwareVcOutreachCampaign(OFFICE_ID, NOW);
    const state = fake.getState();
    const foreignContact = state.contacts.find(
      (contact) => contact.id === "foreign-garry",
    );
    const foreignPlan = state.plans.find((plan) => plan.id === "foreign-plan");
    check(
      "loader does not reuse or mutate a matching contact from another office",
      state.contacts.length === 113 &&
        foreignContact?.email === "foreign@example.com" &&
        foreignContact.notes === "Foreign office note.",
    );
    check(
      "loader does not demote another office's Today queue",
      foreignPlan?.status === "TODAY" &&
        foreignPlan.scheduledFor?.toISOString() ===
          "2026-07-27T00:00:00.000Z",
    );
  });
}

async function expectRollback(
  name: string,
  seed: DatabaseState,
  messagePart: string,
) {
  await withFakePrisma(seed, async (fake) => {
    const before = fake.getState();
    let message = "";
    try {
      await loadHardwareVcOutreachCampaign(OFFICE_ID, NOW);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    check(`${name} returns the expected error`, message.includes(messagePart));
    check(
      `${name} rolls back all writes`,
      JSON.stringify(fake.getState()) === JSON.stringify(before),
    );
  });
}

async function testFailureRollbacks() {
  const protectedSeed = initialState();
  protectedSeed.companies.push({
    id: "yc",
    officeId: OFFICE_ID,
    name: "Astranis",
    website: null,
    crmTags: null,
    sourceRefs: null,
  });
  protectedSeed.contacts.push({
    id: "garry",
    companyId: "yc",
    fullName: "John Gedmark",
    title: null,
    status: "active",
    email: null,
    linkedinUrl: null,
    bookfaceUrl: null,
    phone: null,
    notes: null,
    ownerLabel: null,
    tags: null,
    sourceRefs: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  await expectRollback("protected status rejection", protectedSeed, "protected CRM status");

  const duplicateSeed = cloneState(protectedSeed);
  duplicateSeed.contacts[0].status = "queued";
  duplicateSeed.contacts.push({
    ...duplicateSeed.contacts[0],
    id: "garry-duplicate",
  });
  await expectRollback(
    "duplicate rejection",
    duplicateSeed,
    "Duplicate matching campaign contacts",
  );

  const completedSeed = initialState();
  await withFakePrisma(completedSeed, async (fake) => {
    await loadHardwareVcOutreachCampaign(OFFICE_ID, NOW);
    const loaded = fake.getState();
    loaded.plans[0].status = "REACHED_OUT";
    await expectRollback(
      "completed outreach rejection",
      loaded,
      "already reached this week",
    );
  });

  const skippedSeed = initialState();
  await withFakePrisma(skippedSeed, async (fake) => {
    await loadHardwareVcOutreachCampaign(OFFICE_ID, NOW);
    const loaded = fake.getState();
    loaded.plans[0].status = "SKIPPED";
    await withFakePrisma(loaded, async (reloadedFake) => {
      await loadHardwareVcOutreachCampaign(OFFICE_ID, NOW);
      const reloaded = reloadedFake.getState();
      check(
        "reloading the campaign restores a skipped target to Today",
        reloaded.plans[0].status === "TODAY",
      );
      check(
        "reloading a skipped target preserves the exact channel split",
        JSON.stringify(channelCounts(reloaded)) ===
          JSON.stringify({ bookface: 20, linkedin: 30, email: 62 }),
      );
    });
  });
}

async function main() {
  await testFreshLoadAndIdempotentRerun();
  await testExistingContactPreservationAndQueueReplacement();
  await testForeignOfficeIsolation();
  await testFailureRollbacks();

  if (failures > 0) {
    throw new Error(`${failures} check(s) failed`);
  }

  console.log("hardware-vc-outreach-loader.test.ts passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
