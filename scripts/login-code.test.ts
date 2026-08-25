import assert from "assert";
import {
  allowedLoginEmails,
  generateLoginCode,
  isLoginEmailAllowed,
  loginCodeSmtpConfig,
  loginCodeSmtpConfigured,
  normalizeLoginEmail,
  isUsernameIdentifier,
  isUsernameLoginEmail,
  resolveLoginIdentifier,
  usernameLoginEmail,
} from "../src/lib/login-code";

process.env.AUTH_SECRET = process.env.AUTH_SECRET || "test-secret";

// A fresh database can deliver the first login code without an office Gmail
// row by using the already-configured RFQ SMTP desk.
delete process.env.RFQ_MAIL_USER;
delete process.env.RFQ_MAIL_APP_PASSWORD;
assert.deepStrictEqual(loginCodeSmtpConfig(), {
  user: "rfq@usederya.com",
  appPassword: "",
});
assert.strictEqual(loginCodeSmtpConfigured(), false);

process.env.RFQ_MAIL_USER = "auth@usederya.com";
process.env.RFQ_MAIL_APP_PASSWORD = "abcd efgh ijkl mnop";
assert.deepStrictEqual(loginCodeSmtpConfig(), {
  user: "auth@usederya.com",
  appPassword: "abcdefghijklmnop",
});
assert.strictEqual(loginCodeSmtpConfigured(), true);
delete process.env.RFQ_MAIL_USER;
delete process.env.RFQ_MAIL_APP_PASSWORD;

// Default allowlist: the two founders plus the loadboard operators.
delete process.env.LOGIN_ALLOWED_EMAILS;
assert.deepStrictEqual(allowedLoginEmails(), [
  "mert@usederya.com",
  "oguzhan@usederya.com",
  "atahan@usederya.com",
  "merve@usederya.com",
]);
assert.ok(isLoginEmailAllowed("mert@usederya.com"));
assert.ok(isLoginEmailAllowed("  MERT@USEDERYA.COM  "));
assert.ok(isLoginEmailAllowed("oguzhan@usederya.com"));
assert.ok(isLoginEmailAllowed("atahan@usederya.com"));
assert.ok(isLoginEmailAllowed("merve@usederya.com"));
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
assert.deepStrictEqual(allowedLoginEmails(), [
  "mert@usederya.com",
  "oguzhan@usederya.com",
  "atahan@usederya.com",
  "merve@usederya.com",
]);
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

// Customer offices sign in with a username, which maps onto a reserved
// non-deliverable address so only the password path can use it.
assert.ok(isUsernameIdentifier("maneks"));
assert.ok(!isUsernameIdentifier("mert@usederya.com"));
assert.ok(!isUsernameIdentifier("a"));
assert.ok(!isUsernameIdentifier("bad name"));
assert.strictEqual(usernameLoginEmail(" Maneks "), "maneks@office.derya.invalid");
assert.strictEqual(resolveLoginIdentifier("Maneks"), "maneks@office.derya.invalid");
assert.strictEqual(resolveLoginIdentifier(" Mert@usederya.com "), "mert@usederya.com");
assert.ok(isUsernameLoginEmail("maneks@office.derya.invalid"));
assert.ok(isLoginEmailAllowed("maneks@office.derya.invalid"));
assert.ok(!isLoginEmailAllowed("someone@other.invalid"));

console.log("login-code unit test passed");
