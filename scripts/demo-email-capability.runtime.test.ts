import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { BackgroundJob } from "@prisma/client";
import {
  runDemoEmailCapabilityJob,
  type DemoEmailCapabilityDependencies,
} from "../src/lib/demo-email-capability";
import {
  runOneBackgroundJob,
  type BackgroundJobExecutionDependencies,
} from "../src/lib/background-jobs";
import {
  executeDemoEmailTrigger,
  type DemoEmailTriggerDependencies,
} from "../src/lib/demo-email-trigger";
import {
  syncGmailAppPasswordAccountInternal,
  type ImapSyncDependencies,
} from "../src/lib/imap-sync";

type Call = Record<string, unknown>;

function createRunnerFixture(input: {
  failSubject?: string;
  accountCount?: number;
  unresolvedDelivery?: "PLANNED" | "UNCERTAIN";
  deployedCommitSha?: string | null;
} = {}) {
  const accountCount = input.accountCount ?? 6;
  const accounts = Array.from({ length: accountCount }, (_, index) => ({
    id: `account-${index + 1}`,
    officeId: "office-demo",
    email: `mailbox${index + 1}@example.test`,
    displayName: `Mailbox ${index + 1}`,
    provider: "GMAIL_APP_PASSWORD",
    credentialSecret: "encrypted-placeholder",
    createdAt: new Date(`2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`),
  }));
  const sentMessages: Call[] = [];
  const syncCalls: Call[] = [];
  const taskUpserts: Call[] = [];
  const taskUpdates: Call[] = [];
  const events: Call[] = [];
  const backgroundUpdates: Call[] = [];
  const receivedThreadOwners = new Map<string, string>();
  let sentSequence = 0;
  let threadSequence = 0;
  let inboundSequence = 0;

  const db = {
    emailAccount: {
      findMany: async (args: Call) => {
        assert.deepEqual((args.where as Call).officeId, "office-demo");
        return accounts;
      },
      findFirst: async () => null,
      updateMany: async () => ({ count: 0 }),
      update: async () => ({ id: accounts[0]?.id, email: accounts[0]?.email }),
    },
    user: { findFirst: async () => { throw new Error("demo must not select an admin"); } },
    company: {
      upsert: async (args: Call) => {
        const where = args.where as { officeId_name: { officeId: string; name: string } };
        assert.equal(where.officeId_name.officeId, "office-demo");
        assert.equal(where.officeId_name.name, "HypnoDreamz Email Capability Demo");
        return { id: "company-demo", name: where.officeId_name.name };
      },
    },
    supplyWorkspace: {
      upsert: async () => ({ id: "workspace-demo", name: "HypnoDreamz Email Capability Demo" }),
    },
    supplyWorkspaceMember: { upsert: async () => { throw new Error("demo must not mutate membership"); } },
    supplyExecutionTask: {
      upsert: async (args: Call) => {
        taskUpserts.push(args);
        return { id: "task-demo", status: "PLANNED" };
      },
      updateMany: async (args: Call) => {
        taskUpdates.push(args);
        return { count: 1 };
      },
    },
    supplyExecutionEvent: {
      findMany: async (args: Call) => {
        assert.equal((args.where as Call).officeId, "office-demo");
        if (!input.unresolvedDelivery) return [];
        const status = input.unresolvedDelivery;
        return [{
          eventType: `DEMO_EMAIL_DELIVERY_${status}`,
          status,
          idempotencyKey: `prior-run:delivery:0:INITIAL:${status}`,
        }];
      },
      create: async (args: Call) => {
        events.push(args);
        return { id: `event-${events.length}` };
      },
    },
    emailThread: {
      create: async () => ({ id: `sent-thread-${++threadSequence}` }),
      findFirst: async (args: Call) => {
        const threadId = ((args.where as Call).id as string);
        const accountId = receivedThreadOwners.get(threadId);
        return accountId
          ? { id: threadId, messages: [{ accountId, rfcMessageId: `<received-${threadId}@example.test>` }] }
          : null;
      },
      updateMany: async () => ({ count: 1 }),
    },
    emailMessage: {
      create: async () => ({ id: `message-${sentSequence}` }),
      findFirst: async (args: Call) => {
        const where = args.where as Call;
        const accountId = where.accountId as string;
        const threadId = `received-thread-${++inboundSequence}`;
        receivedThreadOwners.set(threadId, accountId);
        return {
          id: `received-message-${inboundSequence}`,
          threadId,
          sentAt: new Date(`2026-08-23T12:${String(inboundSequence).padStart(2, "0")}:00.000Z`),
          rfcMessageId: `<received-${inboundSequence}@example.test>`,
        };
      },
    },
    backgroundJob: {
      updateMany: async (args: Call) => {
        backgroundUpdates.push(args);
        return { count: 1 };
      },
    },
  };

  const dependencies = {
    db,
    sendMail: async (args: Call) => {
      sentMessages.push(args);
      if (input.failSubject && args.subject === input.failSubject) {
        return { ok: false as const, error: "simulated SMTP failure" };
      }
      const messageId = String(args.messageId);
      assert.match(messageId, /^<derya-demo-[a-f0-9]{32}@app\.derya\.ai>$/);
      sentSequence++;
      return { ok: true as const, messageId };
    },
    syncAccount: async (args: Call) => {
      syncCalls.push(args);
      assert.equal(args.officeId, "office-demo");
      assert.equal(args.skipClassification, true);
      assert.equal(args.demoObservation, true);
      assert.match(String(args.query), /^rfc822msgid:<derya-demo-[a-f0-9]{32}@app\.derya\.ai>$/);
      return { ok: true as const, synced: 1 };
    },
    wait: async () => undefined,
    deployedCommitSha: () => input.deployedCommitSha === undefined ? "a".repeat(40) : input.deployedCommitSha,
  } as unknown as DemoEmailCapabilityDependencies;

  return {
    accounts,
    dependencies,
    sentMessages,
    syncCalls,
    taskUpserts,
    taskUpdates,
    events,
    backgroundUpdates,
  };
}

function jobPayload(accountCount = 6) {
  return {
    accountIds: Array.from({ length: accountCount }, (_, index) => `account-${index + 1}`),
    runKey: "demo-email-run-20260823",
    approvalContext: {
      actor: "mmturna",
      runId: "42",
      runAttempt: "1",
      ref: "refs/heads/main",
      sha: "a".repeat(40),
    },
  };
}

async function testRunnerSuccess() {
  const fixture = createRunnerFixture();
  await runDemoEmailCapabilityJob({
    backgroundJobId: "background-demo",
    officeId: "office-demo",
    payload: jobPayload(),
  }, fixture.dependencies);

  assert.equal(fixture.sentMessages.length, 8, "four conversations should each send and reply");
  assert.equal(fixture.syncCalls.length, 8, "each sent message should be observed in the receiving mailbox");
  assert.equal(fixture.events.length, 23, "start, plan, deliveries, conversations, and completion must be recorded");
  assert.equal(((fixture.events[1].data as Call).eventType), "DEMO_EMAIL_PLAN_APPROVED");
  const eventSequences = fixture.events.map((event) => Number((event.data as Call).sequence));
  assert.equal(new Set(eventSequences).size, eventSequences.length, "execution event sequences must be unique");
  assert.equal(fixture.events.filter((event) => (
    ((event.data as Call).eventType) === "DEMO_EMAIL_DELIVERY_ACKNOWLEDGED"
  )).length, 8);
  assert.equal(((fixture.taskUpserts[0].create as Call).status), "PLANNED");
  assert.deepEqual(
    fixture.taskUpdates.map((update) => (update.data as Call).status),
    ["READY", "RUNNING", "SUCCEEDED"],
  );
  assert.equal(((fixture.taskUpdates[2].where as Call).status), "RUNNING");
  assert.equal(fixture.backgroundUpdates.length, 1);
  const storedPayload = (fixture.backgroundUpdates[0].data as Call).payload as Call;
  const result = storedPayload.result as Call;
  assert.equal(result.accountCount, 6);
  assert.equal(result.passed, 4);
  assert.equal(result.failed, 0);
  assert.equal(result.purchaseCreated, false);
  assert.equal(result.spendAuthorized, false);
  const conversations = result.conversations as Call[];
  assert.equal(conversations.filter((conversation) => conversation.kind === "MAILBOX_PAIR").length, 3);
  assert.equal(conversations.filter((conversation) => conversation.kind === "PROCUREMENT_DEMO").length, 1);
}

async function testRunnerFailureIsRecorded() {
  const token = createHash("sha256").update(JSON.stringify("demo-email-run-20260823")).digest("hex").slice(0, 10);
  const fixture = createRunnerFixture({ failSubject: `Derya mailbox demo 1 ${token}` });
  await assert.rejects(
    runDemoEmailCapabilityJob({
      backgroundJobId: "background-demo",
      officeId: "office-demo",
      payload: jobPayload(),
    }, fixture.dependencies),
    /1 of 4 demo email conversations failed/,
  );
  assert.deepEqual(
    fixture.taskUpdates.map((update) => (update.data as Call).status),
    ["READY", "RUNNING", "FAILED"],
  );
  const storedPayload = (fixture.backgroundUpdates[0].data as Call).payload as Call;
  const result = storedPayload.result as Call;
  assert.equal(result.passed, 3);
  assert.equal(result.failed, 1);
}

async function testRunnerGuards() {
  const fixture = createRunnerFixture();
  await assert.rejects(
    runDemoEmailCapabilityJob({
      backgroundJobId: "background-demo",
      officeId: "office-demo",
      payload: jobPayload(5),
    }, fixture.dependencies),
    /exactly six distinct/,
  );

  const missingAccount = createRunnerFixture({ accountCount: 5 });
  await assert.rejects(
    runDemoEmailCapabilityJob({
      backgroundJobId: "background-demo",
      officeId: "office-demo",
      payload: jobPayload(),
    }, missingAccount.dependencies),
    /All six demo accounts/,
  );

  for (const unresolvedStatus of ["PLANNED", "UNCERTAIN"] as const) {
    const unresolvedDelivery = createRunnerFixture({ unresolvedDelivery: unresolvedStatus });
    await assert.rejects(
      runDemoEmailCapabilityJob({
        backgroundJobId: "background-demo",
        officeId: "office-demo",
        payload: jobPayload(),
      }, unresolvedDelivery.dependencies),
      /must be reconciled before another send/,
    );
    assert.equal(unresolvedDelivery.sentMessages.length, 0);
  }

  const mismatchedDeploy = createRunnerFixture({ deployedCommitSha: "b".repeat(40) });
  await assert.rejects(
    runDemoEmailCapabilityJob({
      backgroundJobId: "background-demo",
      officeId: "office-demo",
      payload: jobPayload(),
    }, mismatchedDeploy.dependencies),
    /deployed application commit does not match/,
  );
  assert.equal(mismatchedDeploy.sentMessages.length, 0);
}

function backgroundJob(overrides: Partial<BackgroundJob> = {}): BackgroundJob {
  const now = new Date("2026-08-23T10:00:00.000Z");
  return {
    id: "job-demo-abcdefghijklmnop",
    officeId: "office-demo",
    type: "DEMO_EMAIL_CAPABILITY_TEST",
    status: "QUEUED",
    payload: jobPayload(),
    dedupeKey: null,
    attempts: 0,
    maxAttempts: 3,
    runAfter: now,
    lockedAt: null,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function runJobState(input: { claimCount?: number; error?: Error; attempts?: number; maxAttempts?: number }) {
  const updates: Call[] = [];
  let updateIndex = 0;
  let executeCount = 0;
  const dependencies = {
    updateMany: async (args: Call) => {
      updates.push(args);
      updateIndex++;
      return { count: updateIndex === 1 ? (input.claimCount ?? 1) : 1 };
    },
    execute: async () => {
      executeCount++;
      if (input.error) throw input.error;
    },
    now: () => new Date("2026-08-23T10:00:00.000Z"),
  } as unknown as BackgroundJobExecutionDependencies;
  const result = await runOneBackgroundJob(backgroundJob({
    attempts: input.attempts ?? 0,
    maxAttempts: input.maxAttempts ?? 3,
  }), dependencies);
  return { result, updates, executeCount };
}

async function testBackgroundJobStates() {
  const skipped = await runJobState({ claimCount: 0 });
  assert.equal(skipped.result, "skipped");
  assert.equal(skipped.executeCount, 0);

  const completed = await runJobState({});
  assert.equal(completed.result, "completed");
  assert.equal(completed.executeCount, 1);
  assert.equal(((completed.updates[1].data as Call).status), "DONE");

  const retried = await runJobState({ error: new Error("temporary"), attempts: 0, maxAttempts: 2 });
  assert.equal(retried.result, "retried");
  assert.equal(((retried.updates[1].data as Call).status), "QUEUED");

  const failed = await runJobState({ error: new Error("permanent"), attempts: 0, maxAttempts: 1 });
  assert.equal(failed.result, "failed");
  assert.equal(((failed.updates[1].data as Call).status), "FAILED");
  assert.equal(((failed.updates[1].data as Call).lastError), "permanent");
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function testTriggerAuthorization() {
  const token = "t".repeat(48);
  const jobId = "demo-job-abcdefghijklmnopqrstuv";
  let runCount = 0;
  const baseDependencies: DemoEmailTriggerDependencies = {
    findJob: async () => ({
      id: jobId,
      type: "DEMO_EMAIL_CAPABILITY_TEST",
      status: "QUEUED",
      payload: { triggerTokenHash: tokenHash(token) },
    }),
    runJob: async () => {
      runCount++;
      return { found: true, outcome: "completed" };
    },
    findCompletedJob: async () => ({
      status: "DONE",
      payload: { result: { passed: 4, failed: 0 } },
      lastError: null,
    }),
  };

  const invalidId = await executeDemoEmailTrigger({ jobId: "bad", token }, baseDependencies);
  assert.equal(invalidId.status, 400);
  assert.equal(runCount, 0);

  const wrongToken = await executeDemoEmailTrigger({ jobId, token: "x".repeat(48) }, baseDependencies);
  assert.equal(wrongToken.status, 404);
  assert.equal(runCount, 0);

  const wrongStatus = await executeDemoEmailTrigger({ jobId, token }, {
    ...baseDependencies,
    findJob: async () => ({
      id: jobId,
      type: "DEMO_EMAIL_CAPABILITY_TEST",
      status: "DONE",
      payload: { triggerTokenHash: tokenHash(token) },
    }),
  });
  assert.equal(wrongStatus.status, 404);
  assert.equal(runCount, 0);

  const valid = await executeDemoEmailTrigger({ jobId, token }, baseDependencies);
  assert.equal(valid.status, 200);
  assert.equal(valid.body.status, "DONE");
  assert.deepEqual(valid.body.result, { passed: 4, failed: 0 });
  assert.equal(runCount, 1);
}

async function testRealImapDemoIsolation(input: {
  subject: string;
  demoObservation?: boolean;
  skipClassification?: boolean;
  correlatePlan?: boolean;
}) {
  const storedThreads: Call[] = [];
  const storedMessages: Call[] = [];
  const forbidden = {
    classify: 0,
    ingestMemory: 0,
    recordMemory: 0,
    logTouch: 0,
    enqueue: 0,
    accountUpdate: 0,
  };
  const messageId = input.correlatePlan
    ? `<derya-demo-${"a".repeat(32)}@app.derya.ai>`
    : "<demo-observation@example.test>";
  const rawMessage = Buffer.from([
    "From: Mailbox 1 <mailbox1@example.test>",
    "To: Mailbox 2 <mailbox2@example.test>",
    `Subject: ${input.subject}`,
    `Message-ID: ${messageId}`,
    "In-Reply-To: <sent-1@example.test>",
    "References: <sent-1@example.test>",
    "Date: Sun, 23 Aug 2026 12:00:00 +0000",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "This is a test-only mailbox observation.",
  ].join("\r\n"));
  const account = {
    id: "account-2",
    officeId: "office-demo",
    email: "mailbox2@example.test",
    displayName: "Mailbox 2",
    provider: "GMAIL_APP_PASSWORD",
    accessToken: null,
    refreshToken: null,
    credentialSecret: "encrypted-placeholder",
    isActive: true,
    sendEnabled: true,
    isDefaultSender: false,
    lastSyncAt: new Date("2026-08-22T00:00:00.000Z"),
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
  };
  const db = {
    supplyExecutionEvent: {
      findFirst: async (args: Call) => {
        if (!input.correlatePlan) throw new Error("explicit demo observation must not query plan correlation");
        const where = args.where as Call;
        assert.equal(where.officeId, "office-demo");
        return {
          payload: {
            senderAccountId: "account-1",
            receiverAccountId: account.id,
            sender: "mailbox1@example.test",
            recipient: account.email,
            subject: input.subject,
            intendedMessageId: messageId,
          },
        };
      },
    },
    emailAccount: {
      findFirst: async () => account,
      updateMany: async () => {
        forbidden.accountUpdate++;
        return { count: 1 };
      },
    },
    emailMessage: {
      findUnique: async () => null,
      updateMany: async () => ({ count: 0 }),
      create: async (args: Call) => {
        storedMessages.push(args);
        return { id: "imap-message-demo" };
      },
    },
    emailThread: {
      findFirst: async () => null,
      create: async (args: Call) => {
        storedThreads.push(args);
        return { id: "imap-thread-demo", jobId: null, inquiryId: null };
      },
      updateMany: async () => ({ count: 1 }),
    },
  };
  const client = {
    usable: true,
    connect: async () => undefined,
    mailboxOpen: async () => undefined,
    search: async () => [1],
    fetchAll: async () => [{
      uid: 1,
      source: rawMessage,
      internalDate: new Date("2026-08-23T12:00:00.000Z"),
    }],
    logout: async () => undefined,
    close: () => undefined,
  };
  const dependencies = {
    db,
    readCredentials: () => ({
      email: account.email,
      displayName: account.displayName,
      appPassword: "unused-test-value",
    }),
    createClient: () => client,
    classifyInbound: async () => {
      forbidden.classify++;
      throw new Error("classification must be skipped");
    },
    ingestMemory: async () => {
      forbidden.ingestMemory++;
      throw new Error("memory ingestion must be skipped");
    },
    recordMemory: async () => {
      forbidden.recordMemory++;
      throw new Error("memory events must be skipped");
    },
    logTouch: async () => {
      forbidden.logTouch++;
      throw new Error("CRM touches must be skipped");
    },
    enqueueJob: async () => {
      forbidden.enqueue++;
      throw new Error("prewarm must be skipped");
    },
    revalidate: () => undefined,
    now: () => new Date("2026-08-23T12:01:00.000Z"),
  } as unknown as ImapSyncDependencies;

  const result = await syncGmailAppPasswordAccountInternal({
    accountId: account.id,
    officeId: account.officeId,
    relatedToMessageId: "<sent-1@example.test>",
    skipClassification: input.skipClassification,
    demoObservation: input.demoObservation,
  }, dependencies);
  assert.equal("error" in result, false);
  assert.equal(storedThreads.length, 1, "demo observation must store the received thread");
  assert.equal(storedMessages.length, 1, "demo observation must store the received message");
  const storedThreadData = storedThreads[0].data as Call;
  const storedMessageData = storedMessages[0].data as Call;
  assert.equal(storedThreadData.autoLinkSkipReason, "DEMO_TEST_ONLY");
  assert.ok(storedThreadData.hiddenAt instanceof Date);
  assert.equal(storedMessageData.classification, "DEMO_TEST_ONLY");
  assert.deepEqual(forbidden, {
    classify: 0,
    ingestMemory: 0,
    recordMemory: 0,
    logTouch: 0,
    enqueue: 0,
    accountUpdate: 0,
  });
}

async function main() {
  await testRunnerSuccess();
  await testRunnerFailureIsRecorded();
  await testRunnerGuards();
  await testBackgroundJobStates();
  await testTriggerAuthorization();
  await testRealImapDemoIsolation({
    subject: "Derya mailbox demo isolation",
    demoObservation: true,
    skipClassification: true,
  });
  await testRealImapDemoIsolation({
    subject: "Normal sync correlated delivery",
    demoObservation: false,
    skipClassification: false,
    correlatePlan: true,
  });
  console.log("demo email capability runtime tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
