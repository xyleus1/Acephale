import assert from "assert";
import { readFileSync } from "fs";
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

// Sign-in surfaces must throttle by client address, cap how many codes one
// mailbox can be sent per day, and never confirm whether an address can sign in.
const loginCodeSource = readFileSync(new URL("../src/lib/login-code.ts", import.meta.url), "utf8");
const loginPageSource = readFileSync(new URL("../src/app/login/page.tsx", import.meta.url), "utf8");
const throttleSource = readFileSync(new URL("../src/lib/login-throttle.ts", import.meta.url), "utf8");
const authSessionRouteSource = readFileSync(
  new URL("../src/lib/auth-session-route.ts", import.meta.url),
  "utf8",
);
const portalThrottleSource = readFileSync(
  new URL("../src/lib/customer-portal-login-rate-limit.ts", import.meta.url),
  "utf8",
);

assert.match(loginCodeSource, /MAX_REQUESTS_PER_DAY/);
assert.match(loginCodeSource, /reason: "daily_limited"/);
// Codes are persisted after they are sent, so the counted caps only hold if one
// mailbox cannot have two sends in flight at once.
assert.match(loginCodeSource, /identity: `login-code-send:\$\{email\}`/);
assert.match(loginCodeSource, /clientAddress/);

for (const identity of ["login-code:", "login-verify:"]) {
  assert.ok(
    loginPageSource.includes(`identity: \`${identity}\${clientAddress}\``),
    `the login page must throttle ${identity} by client address`,
  );
}
// Password identities are shared with the JSON sign-in route so both surfaces
// spend one budget. Failed guesses are also counted against the identifier, so
// rotating the forwarded address does not hand out fresh budgets.
assert.match(loginPageSource, /identity: passwordAddressIdentity\(clientAddress\)/);
assert.match(loginPageSource, /loginAttemptsExhausted\(passwordIdentifierIdentity\(identifier\)/);
assert.match(loginPageSource, /identity: passwordIdentifierIdentity\(identifier\)/);
assert.match(authSessionRouteSource, /return `login-password:\$\{clientAddress\}`/);
assert.match(authSessionRouteSource, /return `login-password-id:\$\{identifier\}`/);
assert.match(loginPageSource, /console\.warn\("login password attempt failed", \{ clientAddress \}\)/);
assert.equal(
  loginPageSource.includes("clientAddress, identifier"),
  false,
  "login logs must not retain submitted identifiers",
);
assert.equal(
  /rate_limited: "[^"]*15 minutes/.test(loginPageSource),
  false,
  "the throttled message must not promise a 15 minute wait it cannot honour",
);
assert.equal(
  loginPageSource.includes("not on the sign-in list"),
  false,
  "the login page must not reveal whether an address is allowlisted",
);
assert.match(loginPageSource, /not_allowed: UNAVAILABLE_TEXT/);
assert.match(loginPageSource, /no_user: UNAVAILABLE_TEXT/);
assert.match(loginPageSource, /send_failed: UNAVAILABLE_TEXT/);

// The throttle hashes the client address, so raw addresses never reach the table.
assert.match(throttleSource, /createHmac\("sha256", secret\)\.update\(identity\)/);
// Vercel sets x-vercel-forwarded-for; x-forwarded-for is caller controlled.
assert.match(throttleSource, /requestHeaders\.get\("x-vercel-forwarded-for"\)/);
assert.ok(
  throttleSource.indexOf('"x-vercel-forwarded-for"') < throttleSource.indexOf('"x-forwarded-for"'),
  "the platform-set address header must be preferred",
);
assert.match(
  readFileSync(new URL("../src/app/portal/page.tsx", import.meta.url), "utf8"),
  /clientAddressFromHeaders\(await headers\(\)\)/,
);
assert.match(portalThrottleSource, /consumeLoginAttempt\(\{ identity: clientAddress/);

console.log("login-code unit test passed");
