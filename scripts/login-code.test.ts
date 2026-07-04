import assert from "assert";
import {
  allowedLoginEmails,
  generateLoginCode,
  isLoginEmailAllowed,
  normalizeLoginEmail,
} from "../src/lib/login-code";

process.env.AUTH_SECRET = process.env.AUTH_SECRET || "test-secret";

// Default allowlist: exactly the two founder accounts.
delete process.env.LOGIN_ALLOWED_EMAILS;
assert.deepStrictEqual(allowedLoginEmails(), ["mert@usederya.com", "oguzhan@usederya.com"]);
assert.ok(isLoginEmailAllowed("mert@usederya.com"));
assert.ok(isLoginEmailAllowed("  MERT@USEDERYA.COM  "));
assert.ok(isLoginEmailAllowed("oguzhan@usederya.com"));
assert.ok(!isLoginEmailAllowed("pentest@derya-pentest.invalid"));
assert.ok(!isLoginEmailAllowed("manager@demo.local"));
assert.ok(!isLoginEmailAllowed("attacker@usederya.com"));
assert.ok(!isLoginEmailAllowed(""));

// Env override extends/replaces the list.
process.env.LOGIN_ALLOWED_EMAILS = "a@x.com, B@Y.com";
assert.deepStrictEqual(allowedLoginEmails(), ["a@x.com", "b@y.com"]);
assert.ok(isLoginEmailAllowed("b@y.com"));
assert.ok(!isLoginEmailAllowed("mert@usederya.com"));

// Empty override falls back to defaults rather than allowing everyone/no one.
process.env.LOGIN_ALLOWED_EMAILS = " , ";
assert.deepStrictEqual(allowedLoginEmails(), ["mert@usederya.com", "oguzhan@usederya.com"]);
delete process.env.LOGIN_ALLOWED_EMAILS;

// Normalization.
assert.strictEqual(normalizeLoginEmail("  Foo@Bar.COM "), "foo@bar.com");

// Codes are always 6 digits, and vary.
const codes = new Set<string>();
for (let i = 0; i < 200; i++) {
  const code = generateLoginCode();
  assert.match(code, /^\d{6}$/);
  codes.add(code);
}
assert.ok(codes.size > 50, "codes should not repeat constantly");

console.log("login-code unit test passed");
