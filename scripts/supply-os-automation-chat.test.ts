import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AutomationChatError,
  enforceAutomationApprovalBoundary,
  normalizeAutomationChatRequest,
  parseAutomationChatResult,
} from "../src/lib/supply-os/automation-chat";

const root = process.cwd();
const route = readFileSync(resolve(root, "src/app/api/supply-os/automations/chat/route.ts"), "utf8");
const client = readFileSync(resolve(root, "src/lib/supply-os/automation-chat.ts"), "utf8");
const workspace = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-automations.tsx"), "utf8");

const request = normalizeAutomationChatRequest({
  company: "Atlas Robotics",
  instruction: "Add an approval gate before sending the carrier request",
  selectedAutomation: {
    name: "Request freight rates",
    purpose: "Prepare lane-specific carrier requests",
    steps: ["Check the lane", "Build the shortlist", "Prepare the request"],
  },
  messages: [{ role: "operator", body: "Keep this specific to ocean freight" }],
});
assert.equal(request.instruction, "Add an approval gate before sending the carrier request");
assert.equal(request.messages.length, 1);

const result = parseAutomationChatResult({
  action: "update",
  reply: "Added operator approval before the carrier request is released.",
  automation: {
    name: "Request freight rates",
    purpose: "Prepare lane-specific carrier requests",
    steps: [
      "Check the lane and cargo inputs",
      "Build the carrier shortlist",
      "Prepare the request",
      "Wait for operator approval before release",
    ],
  },
});
assert.equal(result.action, "update");
assert.equal(result.automation?.steps.at(-1), "Wait for operator approval before release");

const guarded = enforceAutomationApprovalBoundary({
  action: "create",
  reply: "Prepared the carrier message workflow.",
  automation: {
    name: "Send carrier request",
    purpose: "Send a rate request to selected carriers",
    steps: ["Check lane inputs", "Build the carrier list", "Send the request"],
  },
}, request.selectedAutomation);
assert.equal(guarded.automation?.steps.at(-1), "Wait for explicit operator approval");

assert.throws(
  () => parseAutomationChatResult({ action: "create", reply: "Done", automation: null }),
  AutomationChatError,
);
assert.match(route, /const session = await getSession\(\)/);
assert.match(route, /limiter\.consume\(`\$\{session\.officeId\}:\$\{session\.userId\}`\)/);
assert.match(route, /"cache-control": "no-store"/);
assert.match(client, /model: DERYA_AI_MODEL/);
assert.match(client, /type: "json_schema"/);
assert.match(client, /store: false/);
assert.match(client, /Never claim that you executed, sent, filed, booked, purchased, authorized spend/);
assert.match(workspace, /await fetch\("\/api\/supply-os\/automations\/chat"/);
assert.match(workspace, /action === "create"/);
assert.match(workspace, /action === "update"/);
assert.equal(`${route}\n${client}\n${workspace}`.includes("\u2014"), false);

console.log("Supply OS GPT automation chat contract passed.");
