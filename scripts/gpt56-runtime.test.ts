import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DERYA_AI_IDENTITY_REPLY,
  isDeryaModelIdentityQuestion,
} from "../src/lib/gpt56-client";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "../src");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(ts|tsx)$/.test(entry.name) ? [target] : [];
  });
}

const files = sourceFiles(root);
const sources = files.map((file) => ({
  file: path.relative(root, file),
  source: fs.readFileSync(file, "utf8"),
}));
const combined = sources.map(({ file, source }) => `FILE:${file}\n${source}`).join("\n");

assert.doesNotMatch(combined, /@anthropic-ai\/sdk/);
assert.doesNotMatch(combined, /ANTHROPIC_API_KEY/);
assert.doesNotMatch(combined, /claude-(?:haiku|opus|sonnet)/i);
assert.doesNotMatch(combined, /new Anthropic\b/);

const adapter = sources.find(({ file }) => file === "lib/gpt56-client.ts")?.source ?? "";
assert.match(adapter, /DERYA_AI_MODEL = "gpt-5\.6"/);
assert.match(adapter, /client\.responses\.create/);
assert.match(adapter, /_openaiOutput/);
assert.match(adapter, /store: false/);
assert.match(adapter, /timeout: 45_000/);
assert.match(adapter, /maxRetries: 1/);

const agentChat = sources.find(({ file }) => file === "lib/agent-chat.ts")?.source ?? "";
assert.match(agentChat, /isDeryaModelIdentityQuestion/);
assert.equal(
  DERYA_AI_IDENTITY_REPLY,
  "This Derya Desk Assistant runs on OpenAI GPT-5.6 through the Responses API.",
);
assert.equal(isDeryaModelIdentityQuestion("what model are you running"), true);
assert.equal(isDeryaModelIdentityQuestion("are you Claude"), true);
assert.equal(isDeryaModelIdentityQuestion("quote this load"), false);
assert.match(agentChat, /Never identify yourself as Claude/);

const directModelValues = [...combined.matchAll(/\bmodel:\s*["']([^"']+)["']/g)]
  .map((match) => match[1]);
assert.deepEqual(
  [...new Set(directModelValues)].sort(),
  ["gpt-5.6", "whisper-1"],
  "Active model literals must be GPT-5.6, except the speech transcription endpoint.",
);

const anthropicDependency = JSON.parse(
  fs.readFileSync(path.resolve(scriptDir, "../package.json"), "utf8"),
).dependencies?.["@anthropic-ai/sdk"];
assert.equal(anthropicDependency, undefined);

console.log(`GPT-5.6 runtime contract passed across ${files.length} source files`);
