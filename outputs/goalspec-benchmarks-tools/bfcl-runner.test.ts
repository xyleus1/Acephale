import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020";
import { compileCase } from "./bfcl-runner";

test("all 64 frozen public cases compile valid schemas and bounded requests without provider access", () => {
  const cases = JSON.parse(readFileSync("research/goalspec/runs/local-bfcl-v4-dataset-20260916/public-cases.json", "utf8")).entries;
  const ajv = new Ajv2020({ strict: false, logger: false });
  assert.equal(cases.length, 64);
  let maximum = 0;
  for (const row of cases) {
    const request = compileCase(row);
    assert.equal(request.model, "gpt-5.4-2026-03-05");
    assert.equal(request.reasoning, "medium");
    assert.equal(request.maxOutputTokens, 4096);
    assert.equal(request.instructions, "");
    assert.deepEqual(request.input, row.input);
    assert.equal(request.retries, 1);
    maximum += request.maximumAttemptMicrodollars * 2;
    for (const tool of request.tools!) {
      assert.equal(tool.type, "function");
      if (tool.type === "function") {
        assert.match(tool.name, /^[a-zA-Z0-9_-]{1,64}$/);
        ajv.compile(tool.parameters!);
      }
    }
  }
  assert.ok(maximum < 19_000_000);
});

test("over-budget mandatory content fails before dispatch", () => {
  assert.throws(() => compileCase({ id: "oversized", category: "irrelevance", input: [{ role: "user", content: "x ".repeat(40000) }], tools: [] }), /budget|bound/);
});
