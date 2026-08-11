import assert from "node:assert/strict";
import {
  readSupplierQuoteAttachmentsWithAccessToken,
  SupplierQuoteAttachmentError,
} from "../src/lib/supply-os/supplier-quote-attachment-text";

function quotePdf(pageTexts = ["Quote Q-ATT-1. Unit price USD 119.50 per EA. MOQ 6 EA."], fontSize = 11) {
  const fontObject = 3 + pageTexts.length * 2;
  const pageObjects = pageTexts.flatMap((text, index) => {
    const pageObject = 3 + index * 2;
    const contentObject = pageObject + 1;
    const content = `BT\n/F1 ${fontSize} Tf\n1 720 Td\n(${text}) Tj\nET\n`;
    return [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObject} 0 R /Resources << /Font << /F1 ${fontObject} 0 R >> >> >>`,
      `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}endstream`,
    ];
  });
  const pageReferences = pageTexts.map((_, index) => `${3 + index * 2} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageReferences}] /Count ${pageTexts.length} >>`,
    ...pageObjects,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

function baseInput() {
  return {
    accountId: "account-1",
    gmailMessageId: "gmail/message 1",
    attachments: [{ attachmentId: "attachment/1", name: "Q-ATT-1.pdf", mimeType: "application/pdf", size: 2048 }],
  };
}

async function main() {
let fetchCalls = 0;
const parsed = await readSupplierQuoteAttachmentsWithAccessToken(baseInput(), "test-token", async (input, init) => {
  fetchCalls += 1;
  assert.match(String(input), /gmail%2Fmessage%201\/attachments\/attachment%2F1$/);
  assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer test-token");
  const data = quotePdf().toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
});
assert.equal(fetchCalls, 1);
assert.equal(parsed.sources.length, 1);
assert.equal(parsed.sources[0].sourceId, "ATTACHMENT_1");
assert.equal(parsed.sources[0].name, "Q-ATT-1.pdf");
assert.match(parsed.sources[0].text, /Unit price USD 119\.50 per EA/);
assert.match(parsed.sources[0].contentHash, /^[a-f0-9]{64}$/);
assert.deepEqual(parsed.warnings, []);

let skippedFetches = 0;
const unsupported = await readSupplierQuoteAttachmentsWithAccessToken({
  ...baseInput(),
  attachments: [{ attachmentId: "image-1", name: "photo.png", mimeType: "image/png", size: 1200 }],
}, "test-token", async () => {
  skippedFetches += 1;
  throw new Error("Unsupported attachments must not be fetched.");
});
assert.equal(skippedFetches, 0);
assert.match(unsupported.warnings[0], /No supported PDF quote attachment/i);

const oversized = await readSupplierQuoteAttachmentsWithAccessToken({
  ...baseInput(),
  attachments: [{ attachmentId: "large-1", name: "large.pdf", mimeType: "application/pdf", size: 9 * 1024 * 1024 }],
}, "test-token", async () => {
  skippedFetches += 1;
  throw new Error("Oversized attachments must not be fetched.");
});
assert.equal(skippedFetches, 0);
assert.match(oversized.warnings[0], /exceeds the 8 MB extraction limit/i);

const missingProviderId = await readSupplierQuoteAttachmentsWithAccessToken({
  ...baseInput(),
  attachments: [{ attachmentId: null, name: "missing-id.pdf", mimeType: "application/pdf", size: 1200 }],
}, "test-token", async () => {
  throw new Error("An attachment without a provider ID must not be fetched.");
});
assert.match(missingProviderId.warnings[0], /missing its connected-provider attachment identifier/i);

let cappedFetches = 0;
const cappedAttachments = await readSupplierQuoteAttachmentsWithAccessToken({
  ...baseInput(),
  attachments: Array.from({ length: 4 }, (_, index) => ({ attachmentId: `attachment-${index}`, name: `quote-${index}.pdf`, mimeType: "application/pdf", size: 2048 })),
}, "test-token", async () => {
  cappedFetches += 1;
  return new Response(JSON.stringify({ data: quotePdf().toString("base64url") }), { status: 200 });
});
assert.equal(cappedFetches, 3, "only three PDF attachments may be fetched");
assert.equal(cappedAttachments.sources.length, 3);

const pageLimited = await readSupplierQuoteAttachmentsWithAccessToken(baseInput(), "test-token", async () => new Response(JSON.stringify({
  data: quotePdf(Array.from({ length: 26 }, (_, index) => `Page ${index + 1} quote text`)).toString("base64url"),
}), { status: 200 }));
assert.match(pageLimited.sources[0].text, /Page 25 quote text/);
assert.doesNotMatch(pageLimited.sources[0].text, /Page 26 quote text/);
assert.ok(pageLimited.warnings.some((warning) => /first 25 pages/i.test(warning)));

const textLimited = await readSupplierQuoteAttachmentsWithAccessToken(baseInput(), "test-token", async () => new Response(JSON.stringify({
  data: quotePdf(Array.from({ length: 25 }, (_, index) => `Page ${index + 1} ${"A ".repeat(750)}`), 1).toString("base64url"),
}), { status: 200 }));
assert.ok(textLimited.sources[0].text.length <= 30_000);
assert.ok(textLimited.warnings.some((warning) => /text limit/i.test(warning)), JSON.stringify({ length: textLimited.sources[0].text.length, warnings: textLimited.warnings }));

const oversizedProviderResponse = await readSupplierQuoteAttachmentsWithAccessToken({
  ...baseInput(),
  attachments: [{ attachmentId: "unknown-size", name: "unknown-size.pdf", mimeType: "application/pdf", size: null }],
}, "test-token", async () => new Response(JSON.stringify({ data: "ignored" }), {
  status: 200,
  headers: { "content-length": String(12 * 1024 * 1024) },
}));
assert.equal(oversizedProviderResponse.sources.length, 0);
assert.match(oversizedProviderResponse.warnings[0], /exceeds the 8 MB extraction limit/i);

await assert.rejects(
  () => readSupplierQuoteAttachmentsWithAccessToken(baseInput(), "test-token", async () => new Response("", { status: 503 })),
  (error: unknown) => error instanceof SupplierQuoteAttachmentError && /status 503/i.test(error.message),
);

await assert.rejects(
  () => readSupplierQuoteAttachmentsWithAccessToken(baseInput(), "test-token", async () => new Response(JSON.stringify({ data: "" }), { status: 200 })),
  (error: unknown) => error instanceof SupplierQuoteAttachmentError && /empty attachment payload/i.test(error.message),
);

await assert.rejects(
  () => readSupplierQuoteAttachmentsWithAccessToken(baseInput(), "test-token", async () => new Response("{", { status: 200 })),
  (error: unknown) => error instanceof SupplierQuoteAttachmentError && /unreadable attachment response/i.test(error.message),
);

await assert.rejects(
  () => readSupplierQuoteAttachmentsWithAccessToken(baseInput(), "test-token", async () => new Response(JSON.stringify({ data: "not+base64" }), { status: 200 })),
  (error: unknown) => error instanceof SupplierQuoteAttachmentError && /invalid attachment encoding/i.test(error.message),
);

const malformed = await readSupplierQuoteAttachmentsWithAccessToken(baseInput(), "test-token", async () => {
  const data = Buffer.from("not a pdf").toString("base64");
  return new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
});
assert.equal(malformed.sources.length, 0);
assert.match(malformed.warnings[0], /scanned, encrypted, or malformed/i);

console.log("Supply OS supplier quote attachment tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
