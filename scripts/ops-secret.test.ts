import assert from "node:assert/strict";
import { opsSecretMatches } from "../src/lib/ops-secret";

const expected = "ops-provisioning-secret-123456789012345";
const previous = process.env.OPS_PROVISIONING_SECRET;

try {
  assert.equal(opsSecretMatches(expected, expected), true);
  assert.equal(opsSecretMatches("wrong-token", expected), false);
  assert.equal(opsSecretMatches(expected, undefined), false);
  assert.equal(opsSecretMatches(expected, "short-secret"), false);
  assert.equal(opsSecretMatches("", expected), false);
  assert.equal(opsSecretMatches(null, expected), false);
  console.log("Ops secret checks passed.");
} finally {
  if (previous === undefined) delete process.env.OPS_PROVISIONING_SECRET;
  else process.env.OPS_PROVISIONING_SECRET = previous;
}
