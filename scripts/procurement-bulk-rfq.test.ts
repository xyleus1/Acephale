import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/test?sslmode=require";

async function main() {
  const {
    BULK_RFQ_MAX_PER_RUN,
    buildBulkRfqBody,
    buildBulkRfqSubject,
    partitionSuppressedRfqTargets,
    selectBulkRfqBatch,
  } = await import("../src/lib/procurement-bulk-rfq");
  const { readFileSync } = await import("node:fs");
  const { suppressionSkipMessage } = await import("../src/lib/email-delivery-feedback");

  const order = {
    orderId: "24cb31bd-d974-4040-939c-cd8e76dd8967",
    officeId: "office-1",
    companyName: "HypnoDreamz",
    material: "Turnkey 4-layer PCBA",
    specification: "Two-piece rigid PCB, 68.4 x 21.6 mm, FR-4 S1000H Tg150, black solder mask.",
    quantity: "100",
    unit: "finished units",
    neededBy: "2026-10-01",
    notes: "Confirm whether ENIG is required or optional.",
  };
  const target = {
    vendorId: "b7cbb7cf-1f1c-4b7f-9d0f-1f3c4b0d9c11",
    name: "Sierra Circuits",
    website: "https://protoexpress.com",
    contactEmail: "support@protoexpress.com",
  };

  const subject = buildBulkRfqSubject(order);
  assert.equal(subject, "[RFQ 24cb31bd] Turnkey 4-layer PCBA, 100 finished units");
  assert.ok(subject.length <= 180, "the subject must stay inside the header budget");

  const body = buildBulkRfqBody(order, target);
  assert.ok(body.startsWith("Hello Sierra Circuits,"), "the body must address the supplier");
  assert.ok(body.includes("HypnoDreamz"), "the body must name the buying company");
  assert.ok(body.includes("Quantity: 100 finished units"), "the body must carry the order quantity");
  assert.ok(body.includes("Needed by: 2026-10-01"), "the body must carry the requested date");
  assert.ok(body.includes(order.specification), "the body must carry the stored specification");
  assert.ok(body.includes("ENIG"), "the body must carry the clarification note");
  assert.ok(!body.includes("\u2014"), "product copy must not contain em dashes");

  const withoutSpecification = buildBulkRfqBody(
    { ...order, specification: null, notes: null, neededBy: null },
    { ...target, name: "" },
  );
  assert.ok(withoutSpecification.startsWith("Hello there,"), "a missing supplier name must fall back safely");
  assert.ok(
    withoutSpecification.includes("Full specification available on request."),
    "a missing specification must fall back safely",
  );
  assert.ok(!withoutSpecification.includes("Needed by:"), "a missing date must be omitted");

  assert.equal(BULK_RFQ_MAX_PER_RUN, 120, "the per-run cap must stay bounded");

  // Suppressed supplier addresses are blocked before any sender reservation,
  // matched case-insensitively, and everyone else stays sendable in order.
  const bounced = { ...target, vendorId: "vendor-bounced", name: "Bounced Co", contactEmail: "Sales@Bounced.example" };
  const optedOut = { ...target, vendorId: "vendor-opted-out", name: "Quiet Co", contactEmail: "rfq@quiet.example" };
  const partition = partitionSuppressedRfqTargets(
    [target, bounced, optedOut],
    new Map([
      ["sales@bounced.example", "BOUNCED"],
      ["rfq@quiet.example", "OPTED_OUT"],
    ]),
  );
  assert.deepEqual(partition.sendable, [target], "only unsuppressed suppliers remain sendable");
  assert.deepEqual(
    partition.blocked.map((outcome) => [outcome.vendorId, outcome.state, outcome.senderEmail, outcome.error]),
    [
      ["vendor-bounced", "BLOCKED", null, suppressionSkipMessage("BOUNCED")],
      ["vendor-opted-out", "BLOCKED", null, suppressionSkipMessage("OPTED_OUT")],
    ],
    "blocked suppliers carry the deterministic reason and no sender",
  );
  assert.deepEqual(
    partitionSuppressedRfqTargets([target, bounced], new Map()),
    { blocked: [], sendable: [target, bounced] },
    "an empty suppression list blocks nobody",
  );

  // The run limit counts sendable suppliers. With `limit` suppressed rows ahead
  // of the only eligible one, the eligible supplier is still reached and the
  // blocked rows are still reported.
  const suppressedFirst = new Map([
    ["sales@bounced.example", "BOUNCED" as const],
    ["rfq@quiet.example", "OPTED_OUT" as const],
  ]);
  const starved = selectBulkRfqBatch([bounced, optedOut, target], suppressedFirst, 2);
  assert.deepEqual(starved.sendable, [target], "suppressed rows do not consume the run limit");
  assert.deepEqual(starved.blocked.map((outcome) => outcome.vendorId), ["vendor-bounced", "vendor-opted-out"]);
  const second = { ...target, vendorId: "vendor-second", contactEmail: "rfq@second.example" };
  const capped = selectBulkRfqBatch([bounced, target, second], suppressedFirst, 1);
  assert.deepEqual(capped.sendable, [target], "the limit still bounds sendable suppliers");
  assert.equal(capped.blocked.length, 1);
  assert.equal(
    selectBulkRfqBatch(Array.from({ length: BULK_RFQ_MAX_PER_RUN + 5 }, (_, index) => ({
      ...target,
      vendorId: `vendor-${index}`,
      contactEmail: `rfq-${index}@many.example`,
    })), new Map(), 10_000).sendable.length,
    BULK_RFQ_MAX_PER_RUN,
    "the per-run cap applies to sendable suppliers",
  );
  const source = readFileSync("src/lib/procurement-bulk-rfq.ts", "utf8");
  const runBlock = source.slice(source.indexOf("export async function runProcurementBulkRfq"));
  assert.match(runBlock, /listUncontactedBulkRfqTargets\)\(order, input\.vendorIds \?\? null, \{\s*excludeVendorIds: input\.excludeVendorIds \?\? null,\s*\}\)/, "the default run reads every uncontacted supplier, minus reviewer exclusions, before applying the limit");
  const hashCheck = runBlock.indexOf("throw new BulkRfqBatchChangedError(");
  const reserveCall = runBlock.indexOf("reserveEmailSender)");
  assert.ok(hashCheck > runBlock.indexOf("selectBulkRfqBatch(") && hashCheck < reserveCall, "a changed batch is refused after selection and before any sender is reserved");
  const filesLoad = runBlock.indexOf("loadProcurementRfqAttachmentPackage)(");
  assert.ok(filesLoad >= 0 && filesLoad < hashCheck, "the run resolves the file package before the hash check so the hash covers what it will send");
  assert.match(runBlock, /bulkRfqBatchHash\(order, targets, files\)/, "the run hashes the recipients together with the RFQ copy and files");
  assert.match(previewBlockSource(source), /bulkRfqBatchHash\(order, batch\.sendable, options\.files\)/, "the preview computes the same hash from the same inputs");
  assert.match(runBlock, /listSuppressedEmails\)\(order\.officeId, uncontacted\.map\(\(target\) => target\.contactEmail\)\)/, "suppression is applied before the limit, office scoped");
  assert.ok(runBlock.indexOf("selectBulkRfqBatch(") < runBlock.indexOf("reserveEmailSender)"), "no sender is reserved before suppression and limit are settled");
  const sendLoop = runBlock.slice(runBlock.indexOf("for (const target of targets)"));
  const lateCheck = sendLoop.indexOf("listSuppressedEmails(order.officeId, [target.contactEmail])");
  const providerSend = sendLoop.indexOf("provider.send(");
  assert.ok(lateCheck > sendLoop.indexOf("reserveEmailSender)") && lateCheck < providerSend, "each target is rechecked for a late suppression after its sender is reserved and before the provider call");
  const lateBlock = sendLoop.slice(lateCheck, providerSend);
  assert.match(lateBlock, /releaseEmailSenderReservation\(\{ officeId: order\.officeId, reservationId: reservation\.reservationId \}\)/, "a late suppression releases the reservation it just took");
  assert.match(lateBlock, /error: suppressionSkipMessage\(lateSuppression\)/, "a late suppression is a BLOCKED outcome with the deterministic reason");
  const previewBlock = source.slice(
    source.indexOf("export async function listBulkRfqTargets"),
    source.indexOf("export async function listUncontactedBulkRfqTargets"),
  );
  assert.match(previewBlock, /listUncontactedBulkRfqTargets\(order, vendorIds, options\)/, "the preview starts from the same uncontacted list as the run");
  assert.match(previewBlock, /selectBulkRfqBatch\(\s*uncontacted,\s*await listSuppressedEmails\(order\.officeId/, "the preview applies the same office-scoped suppression before the limit");
  const previewRoute = readFileSync("src/app/api/admin/procurement-bulk-rfq/route.ts", "utf8");
  assert.match(previewRoute, /boundedLimit\(req\.nextUrl\.searchParams\.get\("limit"\), BULK_RFQ_MAX_PER_RUN\)/, "the preview defaults to every supplier a maximum-limit send could reach");
  assert.match(previewRoute, /const \{ sendable: targets, blocked, batchHash \} = await listBulkRfqTargets\(order, limit, null, \{ excludeVendorIds, files \}\)/, "the preview selects with the same limit and exclusions the send will use and hashes the same files");
  assert.match(previewRoute, /\.catch\(\(\) => null\);\s*if \(!files\) return NextResponse\.json\([^)]*\{ status: 503 \}\)/, "a preview whose files cannot be resolved fails instead of reviewing an RFQ without files");
  assert.ok(!previewRoute.includes("EMPTY_RFQ_ATTACHMENT_PACKAGE"), "the preview never substitutes an empty package for a failed load");
  assert.match(previewRoute, /blocked: blocked\.map\(/, "suppressed suppliers are shown separately in the preview");
  assert.match(previewRoute, /\.map\(\(item\) => item\.trim\(\)\.toLowerCase\(\)\)\s*\.filter\(\(item\) => \/\^\[a-z0-9-\]\{1,64\}\$\/\.test\(item\)\)/, "struck vendor ids are lowercased so an uppercase uuid still matches the vendor row");
  assert.match(source, /excludeVendorIds \?\? \[\]\)\.map\(\(id\) => id\.trim\(\)\.toLowerCase\(\)\)/, "the domain helper normalizes exclusions the same way for every caller");
  assert.match(source, /!excluded\.has\(row\.vendorId\.toLowerCase\(\)\)/, "vendor rows are compared case-insensitively against exclusions");
  assert.match(previewRoute, /expectedBatchHash,\s*\}\)\);/, "the send forwards the reviewed batch hash to the run");
  assert.match(previewRoute, /error instanceof BulkRfqBatchChangedError/, "a changed batch is a 409, not a partial send");

  const {
    bulkRfqBatchHash,
    BulkRfqBatchChangedError,
    runProcurementBulkRfq,
  } = await import("../src/lib/procurement-bulk-rfq");
  const { EMPTY_RFQ_ATTACHMENT_PACKAGE } = await import("../src/lib/procurement-rfq-attachments");
  const batchA = [target, { ...target, vendorId: "vendor-second", name: "Second Works", contactEmail: "rfq@second.example" }];
  const noFiles = bulkRfqBatchHash(order, batchA, EMPTY_RFQ_ATTACHMENT_PACKAGE);
  assert.equal(noFiles, bulkRfqBatchHash({ ...order }, [...batchA].reverse(), EMPTY_RFQ_ATTACHMENT_PACKAGE), "the batch hash is stable for the same inputs and ignores ordering");
  assert.notEqual(noFiles, bulkRfqBatchHash(order, [target], EMPTY_RFQ_ATTACHMENT_PACKAGE), "dropping a supplier changes the batch hash");
  assert.notEqual(
    noFiles,
    bulkRfqBatchHash(order, [batchA[0], { ...batchA[1], contactEmail: "other@second.example" }], EMPTY_RFQ_ATTACHMENT_PACKAGE),
    "a changed supplier address changes the batch hash",
  );
  assert.notEqual(
    noFiles,
    bulkRfqBatchHash(order, [batchA[0], { ...batchA[1], name: "Second Works GmbH" }], EMPTY_RFQ_ATTACHMENT_PACKAGE),
    "a changed vendor name changes the greeting and therefore the batch hash",
  );
  assert.notEqual(noFiles, bulkRfqBatchHash({ ...order, specification: "Four-piece rigid PCB." }, batchA, EMPTY_RFQ_ATTACHMENT_PACKAGE), "changed order copy changes the batch hash");
  assert.notEqual(noFiles, bulkRfqBatchHash({ ...order, notes: null }, batchA, EMPTY_RFQ_ATTACHMENT_PACKAGE), "a removed note changes the batch hash");
  const drawing = { filename: "enclosure.step", contentType: "model/step", bytes: Buffer.from("solid v1") };
  const withDrawing = {
    attachments: [drawing],
    names: [drawing.filename],
    contextSections: ["Derived from enclosure.step: 60 x 60 mm footprint."],
    withheld: [],
  };
  const withFiles = bulkRfqBatchHash(order, batchA, withDrawing);
  assert.notEqual(noFiles, withFiles, "attaching files changes the batch hash");
  assert.notEqual(
    withFiles,
    bulkRfqBatchHash(order, batchA, { ...withDrawing, attachments: [{ ...drawing, bytes: Buffer.from("solid v2") }] }),
    "a swapped drawing with the same name changes the batch hash",
  );
  assert.equal(
    withFiles,
    bulkRfqBatchHash(order, batchA, { ...withDrawing, attachments: [{ ...drawing, bytes: Buffer.from("solid v1") }] }),
    "the same bytes give the same batch hash",
  );
  const changed = new BulkRfqBatchChangedError("a".repeat(64), "b".repeat(64));
  assert.equal(changed.code, "BATCH_CHANGED");
  assert.match(changed.message, /Preview it again/);

  const alreadySentStatusCalls: Array<{ customerId: string; orderId: string; event: string }> = [];
  const alreadySentTargets = [
    { ...target, vendorId: "already-sent-1" },
    { ...target, vendorId: "already-sent-2", contactEmail: "second@protoexpress.com" },
  ];
  const alreadySentRun = await runProcurementBulkRfq({
    orderId: order.orderId,
    limit: alreadySentTargets.length,
    attachRequestFiles: false,
    loadOrder: (async () => ({
      ...order,
      customerId: "customer-1",
    })) as never,
    loadTargets: (async () => alreadySentTargets) as never,
    listSuppressed: (async () => new Map()) as never,
    reserveSender: (async () => ({
      ok: true,
      reservationId: "reservation-1",
      accountId: "account-1",
      senderEmail: "buyer@example.com",
      dailySendLimit: 100,
      sentToday: 0,
      reservedToday: 0,
      completed: true,
      providerMessageId: "provider-message-1",
      providerThreadId: "provider-thread-1",
      localThreadId: null,
      sentAt: null,
    })) as never,
    advanceStatus: (async (args) => {
      alreadySentStatusCalls.push(args);
      return "sourcing";
    }) as never,
  });
  assert.equal(alreadySentRun.alreadySent, alreadySentTargets.length);
  assert.deepEqual(alreadySentStatusCalls, [{
    customerId: "customer-1",
    orderId: order.orderId,
    event: "rfq_sent",
  }]);

  console.log("procurement-bulk-rfq: all assertions passed");
}

function previewBlockSource(source: string) {
  return source.slice(
    source.indexOf("export async function listBulkRfqTargets"),
    source.indexOf("export function bulkRfqBatchHash"),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
