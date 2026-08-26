import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  OUTBOUND_ATTACHMENT_MAX_COUNT,
  OutboundAttachmentError,
  baseContentType,
  buildMimeMessage,
  encodeGmailRawMessage,
  outboundAttachmentMetadata,
  sanitizeAttachmentFilename,
  validateOutboundAttachments,
} from "../src/lib/outbound-email-attachments";
import {
  prepareRequestDocumentAttachment,
  screenAttachmentContent,
} from "../src/lib/supply-os/request-document-attachments";
import {
  buildFileDeliveryReplyBody,
  documentContextLines,
  fileDeliveryReplySubject,
  procurementRequestDocuments,
} from "../src/lib/procurement-file-delivery-draft";
import type { ProcurementOrderDetail, ProcurementOrderVendor } from "../src/lib/procurement-workflow";

function binaryStl(triangles: number) {
  const bytes = Buffer.alloc(84 + triangles * 50);
  bytes.write("binary stl fixture", 0, "latin1");
  bytes.writeUInt32LE(triangles, 80);
  return bytes;
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("fixture image body"),
]);

const vendor = {
  id: "vendor-1",
  name: "Arctic Circuits",
  website: "https://arcticcircuits.example/",
  contact: { name: "Dana Wolfe", email: "dana@arcticcircuits.example", phone: null },
  contacted: true,
  responseCount: 1,
  status: "shortlisted",
  research: {},
  quote: null,
} satisfies ProcurementOrderVendor;

const order = {
  id: "24cb31bd-d974-4040-939c-cd8e76dd8967",
  status: "sourcing",
  progress: null,
  neededBy: "2026-10-10",
  quantity: 100,
  unit: "finished units",
  material: "PCBA for a rigid mouse bite 2 piece PCB",
  specification: [
    "Surface finish: HASL with lead, and the source also states HASL to ENIG, so confirm the finish",
    "Source quantity on the specification image: 10",
  ].join("\n"),
  requestContext: {
    source: { workspace_id: "workspace-1", company_name: "HypnoDreamz" },
    procurement_context: {
      documents: [
        {
          citation_id: "document:doc-spec",
          name: "hypnodreamz order 1 doc 1.png",
          summary: "PCB fabrication specification image.",
          markdown: [
            "# Specification",
            "This paragraph is prose and must not reach the supplier verbatim.",
            "| Board size | 68.4 x 21.6 mm |",
            "| Layers | 4 |",
            "Material: FR-4 / S1000H TG150",
            "Track and spacing: 6/6 mil",
          ].join("\n"),
        },
        {
          citation_id: "document:doc-bom",
          name: "hypnodreamz order 1 doc 2.csv",
          summary: "Bill of materials, 34 component lines and 71 placements.",
          markdown: [
            "Packages: 0201, 0402",
            "Fine pitch packages: QFN, SON, WSON",
            "Modules: Seeed XIAO nRF52840, MAX30102",
          ].join("\n"),
        },
        { citation_id: "context:not-a-document", name: "unrelated note" },
        { citation_id: "document:", name: "empty id" },
      ],
    },
  },
  approvalRequestedAt: null,
  decisionSnapshot: null,
  vendors: [vendor],
  updatedAt: "2026-08-25T00:00:00.000Z",
} satisfies ProcurementOrderDetail;

function filenameAndTypeHandling() {
  assert.equal(baseContentType("text/csv; charset=utf-8"), "text/csv");
  assert.equal(sanitizeAttachmentFilename("../../etc/passwd"), "etc-passwd");
  const injectedName = sanitizeAttachmentFilename('spec"; name="evil.png');
  assert.equal(/[";=]/.test(injectedName), false, "Quotes and header separators must not survive in a file name.");
  assert.equal(sanitizeAttachmentFilename("bom\r\nBcc: attacker@example.com.csv").includes("\n"), false);
  assert.equal(sanitizeAttachmentFilename("   "), "attachment");
}

function attachmentValidation() {
  const valid = validateOutboundAttachments([
    { filename: "bom.csv", contentType: "text/csv; charset=utf-8", bytes: Buffer.from("ref,qty\nR1,2\n") },
  ]);
  assert.equal(valid[0]?.contentType, "text/csv");
  assert.deepEqual(outboundAttachmentMetadata(valid), [
    { name: "bom.csv", mimeType: "text/csv", size: 13 },
  ]);

  assert.throws(
    () => validateOutboundAttachments([
      { filename: "payload.exe", contentType: "application/x-msdownload", bytes: Buffer.from("MZ") },
    ]),
    OutboundAttachmentError,
    "Unexpected attachment types must be refused.",
  );
  assert.throws(
    () => validateOutboundAttachments([{ filename: "empty.csv", contentType: "text/csv", bytes: Buffer.alloc(0) }]),
    OutboundAttachmentError,
    "Empty attachments must be refused.",
  );
  assert.throws(
    () => validateOutboundAttachments(
      Array.from({ length: OUTBOUND_ATTACHMENT_MAX_COUNT + 1 }, (_unused, index) => ({
        filename: `file-${index}.csv`,
        contentType: "text/csv",
        bytes: Buffer.from("a"),
      })),
    ),
    OutboundAttachmentError,
    "The attachment count limit must hold.",
  );
}

function mimeConstruction() {
  const textOnly = buildMimeMessage({
    headers: ["To: dana@arcticcircuits.example", "Subject: Re: RFQ"],
    text: "Body only.",
  });
  assert.equal(textOnly.includes("multipart/mixed"), false);
  assert.equal(textOnly.includes('Content-Type: text/plain; charset="UTF-8"'), true);

  const message = buildMimeMessage({
    headers: [
      "To: dana@arcticcircuits.example",
      "Subject: Re: RFQ",
      "MIME-Version: 9.9",
      "Content-Type: text/plain",
    ],
    text: "The technical package is attached.",
    attachments: validateOutboundAttachments([
      { filename: "bom.csv", contentType: "text/csv", bytes: Buffer.from("ref,qty\nR1,2\n") },
      { filename: "spec.png", contentType: "image/png", bytes: png },
    ]),
  });
  const boundary = /boundary="([^"]+)"/.exec(message)?.[1];
  assert.ok(boundary, "A multipart message must declare a boundary.");
  assert.equal(message.includes("Content-Type: multipart/mixed"), true);
  assert.equal(message.split(`--${boundary}`).length - 1, 4, "Two parts plus the closing boundary are expected.");
  assert.equal(message.includes(`--${boundary}--`), true);
  assert.equal(message.includes("9.9"), false, "Caller supplied MIME headers must be replaced.");
  assert.equal(message.includes("Content-Disposition: attachment; filename=\"bom.csv\""), true);
  assert.equal(message.includes("Content-Transfer-Encoding: base64"), true);
  assert.equal(message.includes(png.toString("base64").slice(0, 24)), true);
  assert.equal(message.split("\r\n").some((line) => line.length > 998), false, "MIME lines must stay inside the SMTP limit.");

  const raw = encodeGmailRawMessage(message);
  assert.equal(/[+/=]/.test(raw), false, "Gmail requires base64url without padding.");
  assert.equal(Buffer.from(raw, "base64url").toString("utf-8"), message);

  const injected = buildMimeMessage({
    headers: ["To: dana@arcticcircuits.example\r\nBcc: attacker@example.com", "Subject: Re: RFQ"],
    text: "Body.",
  });
  assert.equal(
    injected.split("\r\n").some((line) => /^bcc:/i.test(line)),
    false,
    "An injected header line must not become its own header.",
  );
}

function sensitiveFileScreening() {
  assert.equal(screenAttachmentContent({ name: "bom.csv", contentType: "text/csv", bytes: Buffer.from("ref,qty\n") }).safe, true);
  for (const fixture of [
    { name: ".env", bytes: Buffer.from("HELLO=1") },
    { name: "mailbox-export.csv", bytes: Buffer.from("mailbox,display_name\n") },
    { name: "notes.txt", bytes: Buffer.from("-----BEGIN RSA PRIVATE KEY-----\nabc\n") },
    { name: "notes.txt", bytes: Buffer.from("aws key AKIAIOSFODNN7EXAMPLE here") },
    { name: "notes.txt", bytes: Buffer.from("smtp_password = hunter2") },
    { name: "notes.txt", bytes: Buffer.from("the gmail app-password for the pool") },
  ]) {
    const screened = screenAttachmentContent({ name: fixture.name, contentType: "text/plain", bytes: fixture.bytes });
    assert.equal(screened.safe, false, `${fixture.name} must be withheld.`);
  }
}

function documentPreparation() {
  const stl = binaryStl(12);
  const prepared = prepareRequestDocumentAttachment({
    documentId: "doc-stl",
    name: "hypnodreamz order 1 doc 2.stl",
    mimeType: "model/stl",
    bytes: stl,
  });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.ok && prepared.attachment.contentType, "model/stl");
  assert.equal(prepared.ok && prepared.attachment.filename, "hypnodreamz order 1 doc 2.stl");

  const brokenStl = prepareRequestDocumentAttachment({
    documentId: "doc-stl",
    name: "part.stl",
    mimeType: "model/stl",
    bytes: Buffer.from("this is not a mesh"),
  });
  assert.equal(brokenStl.ok, false);

  const mismatch = prepareRequestDocumentAttachment({
    documentId: "doc-spec",
    name: "spec.png",
    mimeType: "text/csv",
    bytes: png,
  });
  assert.equal(mismatch.ok, false, "A stored type that contradicts the extension must be refused.");

  const fakePng = prepareRequestDocumentAttachment({
    documentId: "doc-spec",
    name: "spec.png",
    mimeType: "image/png",
    bytes: Buffer.from("not an image at all"),
  });
  assert.equal(fakePng.ok, false, "Content that does not match its declared type must be refused.");

  const sensitive = prepareRequestDocumentAttachment({
    documentId: "doc-secret",
    name: "credentials.csv",
    mimeType: "text/csv",
    bytes: Buffer.from("mailbox,app_password\na@b.co,abcd\n"),
  });
  assert.equal(sensitive.ok, false);

  const empty = prepareRequestDocumentAttachment({
    documentId: "doc-empty",
    name: "bom.csv",
    mimeType: "text/csv",
    bytes: Buffer.alloc(0),
  });
  assert.equal(empty.ok, false);
}

function trustedDocumentSelection() {
  const documents = procurementRequestDocuments(order);
  assert.deepEqual(documents.map((document) => document.documentId), ["doc-spec", "doc-bom"]);
  assert.equal(procurementRequestDocuments({ ...order, requestContext: {} }).length, 0);

  const lines = documentContextLines(documents[0]!, 1_400);
  assert.equal(lines.includes("Board size: 68.4 x 21.6 mm"), true);
  assert.equal(lines.includes("Layers: 4"), true);
  assert.equal(
    lines.some((line) => line.includes("This paragraph is prose")),
    false,
    "Prose from the source file must stay out of supplier mail.",
  );
}

function replyBody() {
  const documents = procurementRequestDocuments(order);
  const body = buildFileDeliveryReplyBody({
    order,
    vendor,
    companyName: "HypnoDreamz",
    documents,
    attachments: [
      { documentId: "doc-spec", name: "hypnodreamz-order-1-doc-1.png", mimeType: "image/png", size: 240_000 },
      { documentId: "doc-bom", name: "hypnodreamz-order-1-doc-2.csv", mimeType: "text/csv", size: 4_096 },
    ],
  });
  for (const expected of [
    "Dana Wolfe",
    "hypnodreamz-order-1-doc-1.png",
    "hypnodreamz-order-1-doc-2.csv",
    "100 finished units",
    "2026-10-10",
    "Board size: 68.4 x 21.6 mm",
    "Fine pitch packages: QFN, SON, WSON",
    "Modules: Seeed XIAO nRF52840, MAX30102",
    "confirm the finish",
    "Source quantity on the specification image: 10",
    "Tooling, setup, or NRE cost",
  ]) {
    assert.equal(body.includes(expected), true, `The drafted reply must state: ${expected}`);
  }
  assert.equal(body.includes("\u2014"), false, "Drafted supplier mail must not contain an em dash.");
  assert.equal(
    body.includes("This paragraph is prose"),
    false,
    "Only extracted facts may be quoted back to the supplier.",
  );

  assert.equal(
    fileDeliveryReplySubject({ conversationSubject: "Re: [RFQ 24cb31bd] PCBA", order }),
    "Re: [RFQ 24cb31bd] PCBA",
  );
  assert.equal(
    fileDeliveryReplySubject({ conversationSubject: "[RFQ 24cb31bd] PCBA", order }),
    "Re: [RFQ 24cb31bd] PCBA",
  );
  assert.equal(fileDeliveryReplySubject({ conversationSubject: null, order }).startsWith("Re: [RFQ 24cb31bd]"), true);
}

function draftPathNeverSends() {
  const source = readFileSync("src/lib/procurement-file-delivery-draft.ts", "utf-8");
  for (const forbidden of ["sendNewEmailFromAccount", "sendReplyToThread", "messages/send", "supplier-email-provider"]) {
    assert.equal(source.includes(forbidden), false, `Draft creation must not reference ${forbidden}.`);
  }
}

filenameAndTypeHandling();
attachmentValidation();
mimeConstruction();
sensitiveFileScreening();
documentPreparation();
trustedDocumentSelection();
replyBody();
draftPathNeverSends();
console.log("Supplier attachment draft behavior passed.");
