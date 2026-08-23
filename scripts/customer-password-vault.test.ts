import assert from "node:assert/strict";
import {
  decryptCustomerPassword,
  encryptCustomerPassword,
} from "../src/lib/customer-password-vault";

const secret = "customer-password-vault-test-secret";
const password = "Visible-Customer-Password!42";
const encrypted = encryptCustomerPassword(password, secret);

assert.notEqual(encrypted, password);
assert.equal(decryptCustomerPassword(encrypted, secret), password);
assert.equal(decryptCustomerPassword(encrypted, "wrong-secret"), null);
assert.equal(decryptCustomerPassword(`${encrypted}changed`, secret), null);
assert.equal(decryptCustomerPassword(null, secret), null);

console.log("Customer password vault test passed.");
