import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const page = read("src/app/dashboard/intel/page.tsx");
const desk = read(
  "src/app/dashboard/intel/components/intel-chat-desk.tsx"
);
const deskStyles = read(
  "src/app/dashboard/intel/components/intel-chat-desk.module.css"
);
const agentChat = read("src/lib/agent-chat.ts");
const agentTools = read("src/lib/agent-tools.ts");
const agentWidget = read("src/components/agent-chat-widget.tsx");
const hardwareBrief = read(
  "src/lib/intel/research/hardware-agent-brief.ts"
);

assert.ok(
  page.includes("<IntelChatDesk"),
  "the Intel route starts with the dedicated chat desk"
);
assert.ok(
  page.includes("<OceanHardwareReportData />") &&
    page.includes("report={"),
  "the full sourced report is available to attach to an answer"
);
assert.ok(
  desk.includes("const [messages, setMessages] = useState<IntelChatItem[]>([]);"),
  "the landing state is an empty conversation, not a pre-rendered answer"
);
assert.ok(
  desk.includes('"/dashboard/intel"'),
  "the chat passes its exact Intel page scope to the server"
);
assert.ok(
  desk.includes("message.id === reportMessageId") &&
    desk.includes('tool.name === HARDWARE_REPORT_TOOL') &&
    desk.includes('const HARDWARE_REPORT_TOOL = "get_hardware_import_report"'),
  "the report opens only under the answer that successfully used the report tool"
);
assert.ok(
  desk.includes("What do you need to know?") &&
    desk.includes('placeholder="Ask about imports, customs, routes, providers, or paste a shipment question..."'),
  "the primary surface visibly invites a question"
);
assert.ok(
  desk.includes('href="/dashboard/intel/load"'),
  "real shipment review remains a separate explicit workflow"
);
assert.ok(
  agentChat.includes("function isIntelDeskScope") &&
  agentChat.includes("if (!intelDeskScope && looksLikeRFQ(userMessage))") &&
    agentChat.includes("const suppressImplicitJob = Boolean(leadBoardScope || intelDeskScope)") &&
    agentChat.includes("isPriceQuery(userMessage) && !leadBoardScope && !intelDeskScope") &&
    agentChat.includes("if (intelDeskScope) return;\n    await logAgentRun(args);"),
  "Intel chat blocks RFQ paste ingestion, implicit load focus, and unrelated price prefetch"
);
assert.ok(
  agentChat.includes('intelDeskScope\n      ? Promise.resolve("")\n      : buildCompactCustomerMemoryContext') &&
    agentChat.includes('intelDeskScope\n      ? Promise.resolve("")\n      : buildCompactJobMemoryContext'),
  "Intel chat does not inject customer or job memory"
);
assert.ok(
  agentTools.includes('name: "get_hardware_import_report"') &&
    agentTools.includes('case "get_hardware_import_report"') &&
    agentTools.includes("buildHardwareImportAgentBrief"),
  "the agent exposes and dispatches a deterministic hardware report tool"
);
assert.ok(
  hardwareBrief.includes('connection: "not_connected"') &&
    hardwareBrief.includes("official_aggregate_customs_data") &&
    hardwareBrief.includes("Do not claim a route recommendation"),
  "the report brief preserves provider and evidence limitations"
);
assert.ok(
  agentWidget.includes('pathname === "/dashboard/intel"') &&
    agentWidget.includes('pathname.startsWith("/dashboard/intel/")') &&
    agentWidget.includes("if (isCompanyBrainPage || isIntelPage) return null;"),
  "the global floating chat is suppressed across the isolated Intel workspace"
);
assert.ok(
  deskStyles.includes("position: sticky") &&
    deskStyles.includes(".composerDock"),
  "the question composer remains available while the operator reads an answer"
);

for (const [name, source] of [
  ["Intel page", page],
  ["Intel chat", desk],
  ["Intel chat styles", deskStyles],
  ["hardware agent brief", hardwareBrief],
] as const) {
  assert.equal(
    source.includes("\u2014"),
    false,
    `${name} contains no em dash character`
  );
}

console.log("Intel chat-first checks passed");
