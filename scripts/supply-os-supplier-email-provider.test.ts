import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createGmailSupplierEmailProvider } from "../src/lib/supply-os/supplier-email-provider";

const input = {
  officeId: "office-1",
  accountId: "account-1",
  senderEmail: "buyer@example.com",
  recipient: "supplier@example.com",
  subject: "Quote request\r\nBcc: attacker@example.com",
  body: "Please quote this part.\nNo em dash here.",
  rfcMessageId: "<supply-action-1@derya.ai>",
};

function response(status: number, body: unknown) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function providerWith(request: typeof fetch) {
  return createGmailSupplierEmailProvider({
    account: async () => ({ id: input.accountId, email: input.senderEmail }),
    token: async () => "access-token",
    request,
  });
}

async function main() {
  let sentRequest: { url: string; init?: RequestInit } | null = null;
  const successProvider = providerWith(async (url, init) => {
    sentRequest = { url: String(url), init };
    return response(200, { id: "gmail-message-1", threadId: "gmail-thread-1" });
  });
  const sent = await successProvider.send(input);
  assert.equal(sent.state, "SENT");
  assert.equal(sentRequest?.url, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
  assert.equal(sentRequest?.init?.method, "POST");
  assert.equal((sentRequest?.init?.headers as Record<string, string>).Authorization, "Bearer access-token");
  const requestBody = JSON.parse(String(sentRequest?.init?.body)) as { raw: string };
  const decoded = Buffer.from(requestBody.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  assert.match(decoded, /^From: buyer@example\.com\r\nTo: supplier@example\.com\r\n/);
  assert.match(decoded, /Subject: Quote request Bcc: attacker@example\.com\r\n/);
  assert.match(decoded, /Message-ID: <supply-action-1@derya\.ai>\r\n/);
  assert.ok(!decoded.includes("\r\nBcc: attacker@example.com\r\n"), "header newlines must not create injected headers");

  let threadedRequest: { url: string; init?: RequestInit } | null = null;
  const threadedProvider = providerWith(async (url, init) => {
    threadedRequest = { url: String(url), init };
    return response(200, { id: "gmail-message-followup", threadId: "gmail-thread-original" });
  });
  const threaded = await threadedProvider.send({
    ...input,
    rfcMessageId: "<supply-followup-2@derya.ai>",
    providerThreadId: "gmail-thread-original",
    inReplyToRfcMessageId: "<supply-action-1@derya.ai>",
  });
  assert.equal(threaded.state, "SENT");
  const threadedBody = JSON.parse(String(threadedRequest?.init?.body)) as { raw: string; threadId?: string };
  assert.equal(threadedBody.threadId, "gmail-thread-original");
  const threadedRaw = Buffer.from(threadedBody.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  assert.match(threadedRaw, /In-Reply-To: <supply-action-1@derya\.ai>\r\n/);
  assert.match(threadedRaw, /References: <supply-action-1@derya\.ai>\r\n/);

  for (const status of [401, 403]) {
    const result = await providerWith(async () => response(status, "permission denied")).send(input);
    assert.deepEqual(result, { state: "REJECTED", error: "Gmail send permission is missing. Reconnect the selected inbox.", needsReauth: true });
  }
  const rejected = await providerWith(async () => response(400, "invalid recipient")).send(input);
  assert.equal(rejected.state, "REJECTED");
  assert.match(rejected.error, /400.*invalid recipient/);
  for (const status of [429, 500, 503]) {
    const result = await providerWith(async () => response(status, "temporarily unavailable")).send(input);
    assert.equal(result.state, "UNKNOWN");
    assert.match(result.error, new RegExp(String(status)));
  }
  const timedOut = await providerWith(async () => { throw new Error("request timed out"); }).send(input);
  assert.deepEqual(timedOut, { state: "UNKNOWN", error: "request timed out" });
  const malformed = await providerWith(async () => response(200, { id: "missing-thread" })).send(input);
  assert.equal(malformed.state, "UNKNOWN");

  let reconcileUrl = "";
  const reconcileProvider = providerWith(async (url) => {
    reconcileUrl = String(url);
    return response(200, { messages: [{ id: "gmail-message-2", threadId: "gmail-thread-2" }] });
  });
  const reconciled = await reconcileProvider.reconcile(input);
  assert.equal(reconciled.state, "SENT");
  assert.match(reconcileUrl, /in%3Asent\+rfc822msgid%3A%3Csupply-action-1%40derya\.ai%3E/);
  assert.match(reconcileUrl, /fields=messages%28id%2CthreadId%29/);
  assert.equal((await providerWith(async () => response(200, { messages: [] })).reconcile(input)).state, "NOT_FOUND");
  assert.equal((await providerWith(async () => response(503, "down")).reconcile(input)).state, "UNKNOWN");
  assert.equal((await providerWith(async () => { throw new Error("network unavailable"); }).reconcile(input)).state, "UNKNOWN");

  let requestCalled = false;
  const unavailable = createGmailSupplierEmailProvider({
    account: async () => { throw new Error("sender inactive"); },
    token: async () => "unused",
    request: async () => { requestCalled = true; return response(200, {}); },
  });
  assert.deepEqual(await unavailable.send(input), { state: "REJECTED", error: "sender inactive", needsReauth: true });
  assert.equal((await unavailable.reconcile(input)).state, "UNKNOWN");
  assert.equal(requestCalled, false, "Gmail must not be called when sender identity validation fails");

  console.log("Supply OS supplier email provider checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
