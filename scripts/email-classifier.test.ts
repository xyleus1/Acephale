import assert from "node:assert/strict";
import { classifyInboundEmail } from "../src/lib/email-classifier";

async function main() {
  const sourceResult = await classifyInboundEmail({
    subject: "New shipment request",
    fromEmail: "RFQ@USEDERYA.COM",
    bodyText: "Please quote Shenzhen to Berlin LCL.",
    officeId: "office-test",
  });

  assert.equal(sourceResult.kind, "RFQ");
  assert.equal(sourceResult.relatedConfidence, 95);
  assert.match(sourceResult.reason, /configured Derya RFQ source address/i);

  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const nonSourceResult = await classifyInboundEmail({
    subject: "Calendar update",
    fromEmail: "calendar@example.com",
    bodyText: "Meeting moved.",
    officeId: "office-test",
  });
  if (originalOpenAiKey) process.env.OPENAI_API_KEY = originalOpenAiKey;

  assert.equal(nonSourceResult.kind, "OTHER");
  assert.equal(nonSourceResult.reason, "OPENAI_API_KEY missing");

  console.log("email-classifier deterministic source tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
