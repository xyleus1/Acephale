// One-shot Green API instance configuration: points the instance's webhook at
// this app's adapter route and verifies the instance is authorized (QR scanned).
//
// Usage:
//   GREEN_API_ID_INSTANCE=71030000 GREEN_API_TOKEN=abc \
//   GREEN_API_WEBHOOK_TOKEN=shared-secret \
//   WEBHOOK_URL=https://app.example.com/api/webhooks/whatsapp/greenapi \
//   npx tsx scripts/setup-green-api.ts
//
// Optional: GREEN_API_BASE_URL (from the console's instance page, e.g.
// https://7103.api.greenapi.com - defaults to https://api.green-api.com).
//
// Note: Green API applies settings within ~5 minutes and reboots the instance.

const idInstance = process.env.GREEN_API_ID_INSTANCE;
const token = process.env.GREEN_API_TOKEN;
const webhookToken = process.env.GREEN_API_WEBHOOK_TOKEN;
const webhookUrl = process.env.WEBHOOK_URL;
const baseUrl = (process.env.GREEN_API_BASE_URL ?? "https://api.green-api.com").replace(/\/+$/, "");

if (!idInstance || !token || !webhookUrl || !webhookToken) {
  console.error("Required env: GREEN_API_ID_INSTANCE, GREEN_API_TOKEN, GREEN_API_WEBHOOK_TOKEN, WEBHOOK_URL");
  process.exit(1);
}

async function call(method: string, body?: unknown) {
  const res = await fetch(`${baseUrl}/waInstance${idInstance}/${method}/${token}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} failed: ${res.status} ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function main() {
  const state = await call("getStateInstance");
  console.log("Instance state:", JSON.stringify(state));
  if (state?.stateInstance !== "authorized") {
    console.error("Instance is not authorized yet - scan the QR in the Green API console first.");
    process.exit(1);
  }

  const applied = await call("setSettings", {
    webhookUrl,
    webhookUrlToken: webhookToken,
    incomingWebhook: "yes",
    outgoingWebhook: "no",
    outgoingMessageWebhook: "no",
    outgoingAPIMessageWebhook: "no",
    stateWebhook: "no",
  });
  console.log("setSettings:", JSON.stringify(applied));
  console.log("Settings apply within ~5 minutes (the instance reboots). Then send a WhatsApp to the number and watch the inbox.");

  const settings = await call("getSettings");
  console.log("Current settings snapshot:", JSON.stringify({
    webhookUrl: settings?.webhookUrl,
    incomingWebhook: settings?.incomingWebhook,
  }));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
