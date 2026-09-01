import assert from "node:assert/strict";
import {
  boundedText,
  isOverLength,
  missingDedupeRows,
  readBoundedText,
  resolveDedupeField,
} from "../src/lib/ops-input";

const fields = [
  { key: "domain", label: "Domain", type: "text" as const },
  { key: "employees", label: "Employees", type: "number" as const },
];

async function main() {
  assert.equal(boundedText("  hello  ", 5), "hello");
  assert.equal(boundedText(42, 5), undefined);
  assert.equal(boundedText(null, 5), undefined);
  assert.equal(isOverLength("12345", 5), false);
  assert.equal(isOverLength("123456", 5), true);
  assert.deepEqual(resolveDedupeField(fields, "domain"), fields[0]);
  assert.deepEqual(missingDedupeRows([{ domain: "/" }, { domain: "example.com" }], "domain"), [0]);
  assert.throws(
    () => resolveDedupeField(fields, "missing"),
    { message: "Dedupe field is not in the list definition." },
  );

  const underLimit = await readBoundedText(new Request("http://localhost", {
    method: "POST",
    body: "hello",
  }), 5);
  assert.equal(underLimit, "hello");
  const overLimit = await readBoundedText(new Request("http://localhost", {
    method: "POST",
    body: "hello!",
  }), 5);
  assert.equal(overLimit, null);
  console.log("Ops input checks passed.");
}

void main();
