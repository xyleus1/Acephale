import assert from "node:assert/strict";
import {
  CAMPAIGN_MAX_RECIPIENTS_PER_DOMAIN,
  LiveRecipientGate,
  RECIPIENT_QUALITY_GATE_VERSION,
  addKeptRecipientCaveats,
  addPrunedRecipient,
  capRecipientsPerDomain,
  describeRecipientQualityBlock,
  emptyPruneCounts,
  recipientQualityBlockIsPermanent,
  recipientQualityDataFor,
  recipientQualityPruneLines,
  recipientQualityVerdict,
} from "../src/lib/outreach-recipient-quality";
import type { MailboxVerdict, MailboxVerifier } from "../src/lib/leadgen/verify";

const MX = [{ exchange: "mx.buyerco.com", priority: 10 }];

function blockedReason(email: string, data?: Record<string, unknown>) {
  const verdict = recipientQualityVerdict({ email, data });
  return verdict.blocked ? verdict.reason : null;
}

function fakeVerifier(statusFor: (email: string) => MailboxVerdict["status"]): MailboxVerifier & { calls: string[] } {
  const calls: string[] = [];
  return {
    name: "fake",
    calls,
    async verify(email) {
      calls.push(email);
      return {
        provider: "fake",
        status: statusFor(email),
        reason: `fixture ${statusFor(email)}`,
        score: null,
        acceptAll: null,
        disposable: null,
        free: null,
        role: null,
        disabled: null,
        fullMailbox: null,
        checkedAt: new Date(0).toISOString(),
      };
    },
    usage() {
      return { provider: "fake", calls: calls.length, cached: 0, failures: 0, exhausted: false };
    },
  };
}

async function staticChecks() {
  assert.match(RECIPIENT_QUALITY_GATE_VERSION, /^recipient-gate-/);

  // The exact class of address that reached a mailbox in the last campaign.
  assert.equal(blockedReason("someone@example.com"), "PLACEHOLDER_ADDRESS");
  assert.equal(blockedReason("Support@Example.com"), "PLACEHOLDER_ADDRESS", "case-insensitive");
  assert.equal(blockedReason("buyer@company.test"), "PLACEHOLDER_ADDRESS", "reserved TLD");
  assert.equal(blockedReason("test@buyerco.com"), "PLACEHOLDER_ADDRESS", "template local part");
  assert.equal(blockedReason("info@yourcompany.com"), "PLACEHOLDER_ADDRESS");
  assert.equal(blockedReason("buyer@mailinator.com"), "DISPOSABLE_DOMAIN");
  assert.equal(blockedReason("not an email"), "INVALID_SYNTAX");
  assert.equal(blockedReason("buyer@buyerco"), "INVALID_SYNTAX", "no TLD");
  // Dot-atom local parts and LDH domain labels: the same rule as verifyEmail.
  for (const malformed of [
    ".leading@buyerco.com",
    "trailing.@buyerco.com",
    "double..dot@buyerco.com",
    "buyer@-buyerco.com",
    "buyer@buyerco-.com",
    "buyer@buyerco..com",
    "buyer@.buyerco.com",
    `${"a".repeat(65)}@buyerco.com`,
  ]) {
    assert.equal(blockedReason(malformed), "INVALID_SYNTAX", malformed);
  }
  assert.equal(blockedReason("first.last+tag@sub-domain.buyerco.co.uk"), null, "dotted local part and hyphenated labels stay valid");
  // Real organisations and mailbox providers are never placeholders; only
  // reserved/example/template domains and generated tokens are.
  for (const legitimate of [
    "buyer@email.com", "sales@sentry.io", "team@w3.org", "contact@schema.org",
    "sales@domain.com", "buyer@test.com", "ops@testing.com", "hello@sample.com", "info@website.com",
  ]) {
    assert.equal(blockedReason(legitimate), null, legitimate);
  }
  for (const template of ["info@yourcompany.com", "name@domain.tld", "user@mail.example", "bilgi@sirket.com"]) {
    assert.equal(blockedReason(template), "PLACEHOLDER_ADDRESS", template);
  }

  // A stored verdict follows the address it was produced for: once the row's
  // address differs from the recipient, the verdict is dropped and the rest of
  // the row is kept. A row without an address, or with the same address, is
  // returned untouched.
  const verifiedRow = { email: "approved@buyerco.com", website: "https://buyerco.com", email_verdict: "deliverable_likely" };
  assert.equal(recipientQualityDataFor(verifiedRow, "email", "Approved@BuyerCo.com"), verifiedRow);
  assert.deepEqual(recipientQualityDataFor(verifiedRow, "email", "other@buyerco.com"), { email: "approved@buyerco.com", website: "https://buyerco.com" });
  assert.deepEqual(recipientQualityDataFor({ contact_email: "x@buyerco.com", email_verdict: "undeliverable" }, "contact_email", "y@buyerco.com"), { contact_email: "x@buyerco.com" });
  assert.deepEqual(recipientQualityDataFor({ email_verdict: "undeliverable" }, null, "y@buyerco.com"), { email_verdict: "undeliverable" });
  assert.equal(recipientQualityDataFor(undefined, "email", "y@buyerco.com"), undefined);
  assert.equal(blockedReason(`${"0123456789abcdef".repeat(2)}@sentry.io`), "PLACEHOLDER_ADDRESS", "an ingest token is not a mailbox");
  assert.equal(blockedReason("buyer@buyerco.com", { email_verdict: "undeliverable" }), "UNDELIVERABLE");
  assert.equal(blockedReason("buyer@buyerco.com", { email_verdict: "UNDELIVERABLE " }), "UNDELIVERABLE", "stored verdict is normalized");

  const clean = recipientQualityVerdict({
    email: "buyer@buyerco.com",
    data: { email_verdict: "deliverable_likely", website: "https://www.buyerco.com/contact" },
  });
  assert.deepEqual(clean, { blocked: false, warnings: [], caveats: [] });

  const weak = recipientQualityVerdict({ email: "buyer@otherco.com", data: { email_verdict: "risky", domain: "buyerco.com" } });
  assert.equal(weak.blocked, false);
  assert.ok(!weak.blocked && weak.warnings.some((line) => line.includes("not confirmed deliverable")), "risky verdict warns");
  assert.ok(!weak.blocked && weak.warnings.some((line) => line.includes("differs from company domain buyerco.com")), "domain mismatch warns");
  assert.deepEqual(!weak.blocked && weak.caveats, ["UNCONFIRMED_MAILBOX", "DOMAIN_MISMATCH"]);

  const bare = recipientQualityVerdict({ email: "buyer@buyerco.com" });
  assert.ok(!bare.blocked && bare.warnings.some((line) => line.includes("no website, domain, or source URL")), "missing evidence warns, not blocks");
  assert.deepEqual(!bare.blocked && bare.caveats, ["NO_ORGANIZATION_EVIDENCE"]);
  const evidenced = recipientQualityVerdict({ email: "buyer@buyerco.com", data: { evidence_urls: ["https://directory.eu/buyerco"] } });
  assert.ok(!evidenced.blocked && evidenced.warnings.length === 0, "a source URL is organisation evidence");

  const freeMail = recipientQualityVerdict({ email: "buyer@gmail.com", data: { domain: "buyerco.com" } });
  assert.ok(!freeMail.blocked && freeMail.warnings.length === 0, "free-mail addresses are not a company-domain mismatch");

  for (const reason of ["PLACEHOLDER_ADDRESS", "DISPOSABLE_DOMAIN", "UNDELIVERABLE", "NO_MX"] as const) {
    assert.equal(recipientQualityBlockIsPermanent(reason), true, reason);
  }
  assert.equal(recipientQualityBlockIsPermanent("INVALID_SYNTAX"), false);
  assert.equal(recipientQualityBlockIsPermanent("DOMAIN_CONCENTRATION"), false);
  assert.equal(describeRecipientQualityBlock("NO_MX"), "domain accepts no mail");
  assert.equal(describeRecipientQualityBlock("PLACEHOLDER_ADDRESS", "placeholder domain"), "placeholder or template address (placeholder domain)");

  const counts = emptyPruneCounts();
  assert.deepEqual(recipientQualityPruneLines(counts), ["Pruned before review: none, every eligible row passed the recipient quality gate."]);
  for (let index = 0; index < 7; index += 1) addPrunedRecipient(counts, { email: `Someone${index}@Example.com`, reason: "PLACEHOLDER_ADDRESS" });
  addPrunedRecipient(counts, { email: "buyer@mailinator.com", reason: "DISPOSABLE_DOMAIN" });
  assert.equal(counts.total, 8);
  assert.deepEqual(counts.reasons, [{ reason: "PLACEHOLDER_ADDRESS", count: 7 }, { reason: "DISPOSABLE_DOMAIN", count: 1 }]);
  assert.equal(counts.examples.length, 5, "examples are capped");
  assert.equal(counts.examples[0], "someone0@example.com", "examples are normalized");
  const lines = recipientQualityPruneLines(counts);
  assert.equal(lines[0], "Pruned before review: 8 recipients removed (7 placeholder or template address; 1 disposable mailbox provider).");
  assert.match(lines[1], /^Pruned examples: someone0@example\.com, /);
  assert.equal(lines.length, 2, "no caveat line when every kept row has evidence");
  addKeptRecipientCaveats(counts, ["NO_ORGANIZATION_EVIDENCE"]);
  addKeptRecipientCaveats(counts, ["NO_ORGANIZATION_EVIDENCE", "UNCONFIRMED_MAILBOX"]);
  addKeptRecipientCaveats(counts, []);
  assert.deepEqual(counts.caveats, [
    { warning: "NO_ORGANIZATION_EVIDENCE", count: 2 },
    { warning: "UNCONFIRMED_MAILBOX", count: 1 },
  ]);
  assert.equal(
    recipientQualityPruneLines(counts)[2],
    "Kept with caveats: 2 no website, domain, or source URL on the row; 1 not confirmed deliverable at research time. Strike recipients you cannot place, or tighten the list before approving.",
  );
  const caveatOnly = emptyPruneCounts();
  addKeptRecipientCaveats(caveatOnly, ["DOMAIN_MISMATCH"]);
  assert.equal(recipientQualityPruneLines(caveatOnly).length, 2, "caveats are reported even when nothing was pruned");

  const rows = [
    ...Array.from({ length: CAMPAIGN_MAX_RECIPIENTS_PER_DOMAIN + 2 }, (_, index) => `buyer${index}@sales.buyerco.com`),
    "a@gmail.com", "b@gmail.com", "c@gmail.com", "d@gmail.com",
    "solo@otherco.com",
  ];
  const capped = capRecipientsPerDomain({ rows, recipientOf: (row) => row });
  assert.deepEqual(capped.dropped, ["buyer3@sales.buyerco.com", "buyer4@sales.buyerco.com"], "subdomains count against the registrable domain, first rows win");
  assert.equal(capped.kept.length, rows.length - 2);
  assert.ok(capped.kept.filter((row) => row.endsWith("@gmail.com")).length === 4, "free-mail domains are exempt from the cap");

  // Multi-label public suffixes: unrelated registrants under com.au, co.uk,
  // com.tr, or com.br are different companies and never share one cap.
  const suffixRows = [
    "a@alpha.com.au", "b@alpha.com.au", "c@alpha.com.au", "d@alpha.com.au",
    "a@beta.com.au", "b@mail.beta.com.au", "c@beta.com.au", "d@beta.com.au",
    "a@gamma.co.uk", "a@delta.co.uk", "a@epsilon.co.uk", "a@zeta.co.uk",
    "a@eta.com.tr", "a@theta.com.tr", "a@iota.com.tr", "a@kappa.com.tr",
    "a@lambda.com.br", "a@mu.com.br", "a@nu.com.br", "a@xi.com.br",
  ];
  const suffixCapped = capRecipientsPerDomain({ rows: suffixRows, recipientOf: (row) => row });
  assert.deepEqual(
    suffixCapped.dropped,
    ["d@alpha.com.au", "d@beta.com.au"],
    "alpha.com.au and beta.com.au are distinct registrable domains; single registrants under a shared suffix are never capped together",
  );
  const mismatch = recipientQualityVerdict({ email: "buyer@alpha.com.au", data: { website: "https://www.alpha.com.au" } });
  assert.ok(!mismatch.blocked && mismatch.warnings.length === 0, "a website on the same com.au registrant is not a domain mismatch");
  const realMismatch = recipientQualityVerdict({ email: "buyer@beta.com.au", data: { domain: "alpha.com.au" } });
  assert.ok(!realMismatch.blocked && realMismatch.caveats.includes("DOMAIN_MISMATCH"), "different com.au registrants are a mismatch");
}

type DnsError = Error & { code: string };
const dnsError = (code: string, domain: string): DnsError => Object.assign(new Error(`query ${code} ${domain}`), { code });

// RFC 5321 implicit MX: a domain with no MX record but an A or AAAA record
// still receives mail at that host. Only an explicit Null MX or a domain that
// does not exist is authoritative no-mail.
async function implicitMxChecks() {
  const addressCalls: string[] = [];
  const gate = new LiveRecipientGate({
    verifier: null,
    resolveMx: async (domain) => {
      switch (domain) {
        case "a-only.com": return [];
        case "aaaa-only.com": return [];
        case "nodata.com": throw dnsError("ENODATA", domain);
        case "parked.com": return [];
        case "nullmx.com": return [{ exchange: ".", priority: 0 }];
        case "nowhere.com": throw dnsError("ENOTFOUND", domain);
        case "nodata-nowhere.com": throw dnsError("ENODATA", domain);
        case "nodata-flaky.com": throw dnsError("ENODATA", domain);
        default: return MX;
      }
    },
    resolveAddress: async (domain) => {
      addressCalls.push(domain);
      switch (domain) {
        case "a-only.com": return ["203.0.113.10"];
        case "aaaa-only.com": return ["2001:db8::10"];
        case "nodata.com": return ["203.0.113.11"];
        case "parked.com": return [];
        case "nodata-nowhere.com": throw dnsError("ENOTFOUND", domain);
        case "nodata-flaky.com": throw dnsError("ETIMEOUT", domain);
        default: throw new Error(`unexpected address lookup for ${domain}`);
      }
    },
  });

  const aOnly = await gate.check("r1", "buyer@a-only.com", undefined);
  assert.ok(aOnly.ok, "empty MX plus an A record is sendable");
  assert.ok(aOnly.ok && !aOnly.warnings.includes("mx lookup unavailable, sent unverified"), "an implicit MX is a real answer, not an outage");
  const aaaaOnly = await gate.check("r2", "buyer@aaaa-only.com", undefined);
  assert.ok(aaaaOnly.ok, "empty MX plus an AAAA record is sendable");
  const nodata = await gate.check("r3", "buyer@nodata.com", undefined);
  assert.ok(nodata.ok, "ENODATA on MX plus an A record is sendable");

  const parked = await gate.check("r4", "buyer@parked.com", undefined);
  assert.ok(!parked.ok && parked.reason === "NO_MX", "no MX and no address record takes no mail");
  assert.ok(!parked.ok && parked.detail.includes("no MX and no address record"));
  const nullMx = await gate.check("r5", "buyer@nullmx.com", undefined);
  assert.ok(!nullMx.ok && nullMx.reason === "NO_MX", "explicit Null MX stays a permanent block");
  assert.ok(!nullMx.ok && nullMx.detail.includes("Null MX"));
  const nxdomain = await gate.check("r6", "buyer@nowhere.com", undefined);
  assert.ok(!nxdomain.ok && nxdomain.reason === "NO_MX", "NXDOMAIN stays a permanent block");
  assert.ok(!nxdomain.ok && nxdomain.detail.includes("does not exist"));
  const nodataNowhere = await gate.check("r7", "buyer@nodata-nowhere.com", undefined);
  assert.ok(!nodataNowhere.ok && nodataNowhere.reason === "NO_MX", "ENODATA on MX followed by NXDOMAIN on A/AAAA is no-mail");
  assert.ok(nullMx.ok === false && nxdomain.ok === false && recipientQualityBlockIsPermanent("NO_MX"), "both authoritative answers suppress permanently");

  const flaky = await gate.check("r8", "buyer@nodata-flaky.com", undefined);
  assert.ok(flaky.ok, "a resolver failure on the address fallback is not evidence about the domain");
  assert.ok(flaky.ok && flaky.warnings.includes("mx lookup unavailable, sent unverified"));

  assert.ok(!addressCalls.includes("nullmx.com") && !addressCalls.includes("nowhere.com"), "authoritative MX answers never fall back to address lookups");
  await gate.check("r9", "second@a-only.com", undefined);
  assert.equal(addressCalls.filter((domain) => domain === "a-only.com").length, 1, "the implicit MX answer is cached per domain like a real MX answer");
}

async function liveChecks() {
  const mxCalls: string[] = [];
  const verifier = fakeVerifier((email) => (email.startsWith("gone@") ? "undeliverable" : email.startsWith("maybe@") ? "risky" : "deliverable"));
  const gate = new LiveRecipientGate({
    verifier,
    budget: 3,
    resolveMx: async (domain) => {
      mxCalls.push(domain);
      if (domain === "nullmx.com") return [{ exchange: ".", priority: 0 }];
      if (domain === "nowhere.com") throw Object.assign(new Error("queryMx ENOTFOUND nowhere.com"), { code: "ENOTFOUND" });
      if (domain === "flaky.com") throw Object.assign(new Error("queryMx ETIMEOUT flaky.com"), { code: "ETIMEOUT" });
      return MX;
    },
  });
  const exhaustedGate = new LiveRecipientGate({
    verifier: {
      name: "exhausted",
      verify: async () => {
        throw new Error("not called");
      },
      usage: () => ({ provider: "exhausted", calls: 1, cached: 0, failures: 1, exhausted: true }),
    },
    resolveMx: async () => MX,
  });
  assert.equal(exhaustedGate.verifierExhausted(), true);

  const placeholder = await gate.check("r1", "someone@example.com", undefined);
  assert.equal(placeholder.ok, false);
  assert.ok(!placeholder.ok && placeholder.reason === "PLACEHOLDER_ADDRESS");
  assert.deepEqual(mxCalls, [], "static blocks never reach DNS");

  const nullMx = await gate.check("r2", "buyer@nullmx.com", undefined);
  assert.ok(!nullMx.ok && nullMx.reason === "NO_MX", "RFC 7505 Null MX is authoritative no-mail");
  const nxdomain = await gate.check("r3", "buyer@nowhere.com", undefined);
  assert.ok(!nxdomain.ok && nxdomain.reason === "NO_MX", "ENOTFOUND is authoritative no-mail");
  assert.equal(verifier.calls.length, 0, "no paid check for a domain that takes no mail");

  const flaky = await gate.check("r4", "buyer@flaky.com", undefined);
  assert.ok(flaky.ok, "a resolver outage is not evidence about the address");
  assert.ok(flaky.ok && flaky.verification === null && flaky.warnings.includes("mx lookup unavailable, sent unverified"));
  assert.equal(verifier.calls.length, 0, "no paid check without an MX answer");

  const confirmed = await gate.check("r5", "buyer@buyerco.com", { email_verdict: "deliverable_likely", website: "https://buyerco.com" });
  assert.ok(confirmed.ok && confirmed.verification?.verdict === "deliverable_likely");
  assert.equal(verifier.calls.length, 0, "a row research already confirmed is not paid for again");
  assert.equal(gate.paidChecks, 0);

  const gone = await gate.check("r6", "gone@buyerco.com", { website: "https://buyerco.com" });
  assert.ok(!gone.ok && gone.reason === "UNDELIVERABLE");
  assert.ok(!gone.ok && gone.detail.startsWith("fake: fixture undeliverable"));
  assert.deepEqual(verifier.calls, ["gone@buyerco.com"]);
  assert.equal(gate.paidChecks, 1);

  const maybe = await gate.check("r7", "maybe@buyerco.com", { website: "https://buyerco.com" });
  assert.ok(maybe.ok && maybe.warnings.includes("mailbox verdict risky"), "risky is sent with a warning, not blocked");
  const fine = await gate.check("r8", "fine@buyerco.com", { website: "https://buyerco.com" });
  assert.ok(fine.ok && fine.verification?.verdict === "deliverable_likely");
  assert.equal(gate.paidChecks, 3);
  assert.equal(gate.budgetReached, false);

  const unpaid = await gate.check("r9", "gone2@buyerco.com", { website: "https://buyerco.com" });
  assert.ok(unpaid.ok, "past the budget the free checks decide");
  assert.equal(gate.paidChecks, 3);
  assert.equal(gate.budgetReached, true);
  assert.equal(verifier.calls.length, 3);
  assert.deepEqual(
    mxCalls.filter((domain) => domain === "buyerco.com").length,
    1,
    "one MX lookup per domain for the whole batch",
  );

  const offline = new LiveRecipientGate({ verifier: null, resolveMx: async () => MX });
  const unverified = await offline.check("r10", "buyer@buyerco.com", undefined);
  assert.ok(unverified.ok && unverified.verification?.verdict !== "undeliverable");
  assert.equal(offline.paidChecks, 0);
  assert.equal(offline.budgetReached, false, "no verifier means the budget is never the limiting factor");
}

staticChecks()
  .then(liveChecks)
  .then(implicitMxChecks)
  .then(() => {
    console.log("outreach-recipient-quality: all assertions passed");
  }, (error: unknown) => {
    console.error(error);
    process.exit(1);
  });
