import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/test?sslmode=require";

async function main() {
  const {
    BULK_RFQ_MAX_PER_RUN,
    buildBulkRfqBody,
    buildBulkRfqSubject,
  } = await import("../src/lib/procurement-bulk-rfq");

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

  console.log("procurement-bulk-rfq: all assertions passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
