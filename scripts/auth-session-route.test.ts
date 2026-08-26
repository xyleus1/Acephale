import assert from "node:assert/strict";
import {
  handleAuthSessionPost,
  type AuthSessionRouteDependencies,
} from "../src/lib/auth-session-route";

const SESSION_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

function request(body: string, headers: HeadersInit = {}) {
  return new Request("http://test.local/api/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

async function responseJson(response: Response) {
  return await response.json() as Record<string, unknown>;
}

function dependencies(overrides: Partial<AuthSessionRouteDependencies> = {}): AuthSessionRouteDependencies {
  return {
    resolveIdentifier: (identifier) => `${identifier.toLowerCase()}@office.derya.invalid`,
    login: async () => null,
    sessionMaxAgeSeconds: SESSION_MAX_AGE_SECONDS,
    ...overrides,
  };
}

async function main() {
const invalidJson = await handleAuthSessionPost(request("{"), dependencies());
assert.equal(invalidJson.status, 400);
assert.equal(typeof (await responseJson(invalidJson)).error, "string");

const missingPassword = await handleAuthSessionPost(
  request(JSON.stringify({ identifier: "guild" })),
  dependencies(),
);
assert.equal(missingPassword.status, 400);
assert.equal(typeof (await responseJson(missingPassword)).error, "string");

let failedLoginIdentifier = "";
let failedLoginPassword = "";
const failedCredentials = await handleAuthSessionPost(
  request(JSON.stringify({ identifier: " guild ", password: "wrong-password" }), {
    "x-forwarded-for": "198.51.100.11, 10.0.0.1",
  }),
  dependencies({
    resolveIdentifier: (identifier) => {
      failedLoginIdentifier = identifier;
      return identifier;
    },
    login: async (identifier, password) => {
      failedLoginIdentifier = identifier;
      failedLoginPassword = password;
      return null;
    },
  }),
);
assert.equal(failedCredentials.status, 401);
assert.equal((await responseJson(failedCredentials)).error, "Invalid username, email, or password.");
assert.equal(failedLoginIdentifier, "guild");
assert.equal(failedLoginPassword, "wrong-password");

const throttleDependencies = dependencies({
  login: async () => null,
  now: () => 1_000_000,
});
for (let attempt = 1; attempt <= 5; attempt++) {
  const response = await handleAuthSessionPost(
    request(JSON.stringify({ identifier: "throttle-user", password: "wrong" }), {
      "x-forwarded-for": "198.51.100.12, 10.0.0.2",
    }),
    throttleDependencies,
  );
  assert.equal(response.status, 401, `attempt ${attempt} should fail credentials`);
}
const throttled = await handleAuthSessionPost(
  request(JSON.stringify({ identifier: "throttle-user", password: "wrong" }), {
    "x-forwarded-for": "198.51.100.12, 10.0.0.2",
  }),
  throttleDependencies,
);
assert.equal(throttled.status, 429);
assert.equal(
  (await responseJson(throttled)).error,
  "Too many sign-in attempts. Wait 15 minutes and try again.",
);

const rotatingIpThrottleDependencies = dependencies({
  login: async () => null,
  now: () => 2_000_000,
});
for (let attempt = 1; attempt <= 5; attempt++) {
  const response = await handleAuthSessionPost(
    request(JSON.stringify({ identifier: "rotating-ip-user", password: "wrong" }), {
      "x-forwarded-for": `198.51.100.${20 + attempt}`,
    }),
    rotatingIpThrottleDependencies,
  );
  assert.equal(response.status, 401, `rotating IP attempt ${attempt} should fail credentials`);
}
const rotatingIpThrottled = await handleAuthSessionPost(
  request(JSON.stringify({ identifier: "rotating-ip-user", password: "wrong" }), {
    "x-forwarded-for": "198.51.100.26",
  }),
  rotatingIpThrottleDependencies,
);
assert.equal(rotatingIpThrottled.status, 429);
assert.equal(
  (await responseJson(rotatingIpThrottled)).error,
  "Too many sign-in attempts. Wait 15 minutes and try again.",
);

let clearIdentifierThrottle = false;
const clearIdentifierThrottleDependencies = dependencies({
  now: () => 3_000_000,
  login: async () => clearIdentifierThrottle
    ? { officeId: "office-clear", role: "ADMIN", canViewWholeOffice: true }
    : null,
});
for (let attempt = 1; attempt <= 4; attempt++) {
  const response = await handleAuthSessionPost(
    request(JSON.stringify({ identifier: "clear-throttle-user", password: "wrong" }), {
      "x-forwarded-for": `198.51.100.${30 + attempt}`,
    }),
    clearIdentifierThrottleDependencies,
  );
  assert.equal(response.status, 401, `clear counter attempt ${attempt} should fail credentials`);
}
clearIdentifierThrottle = true;
const clearCounterSuccess = await handleAuthSessionPost(
  request(JSON.stringify({ identifier: "clear-throttle-user", password: "correct" }), {
    "x-forwarded-for": "198.51.100.35",
  }),
  clearIdentifierThrottleDependencies,
);
assert.equal(clearCounterSuccess.status, 200);
clearIdentifierThrottle = false;
for (let attempt = 1; attempt <= 5; attempt++) {
  const response = await handleAuthSessionPost(
    request(JSON.stringify({ identifier: "clear-throttle-user", password: "wrong" }), {
      "x-forwarded-for": `198.51.100.${40 + attempt}`,
    }),
    clearIdentifierThrottleDependencies,
  );
  assert.equal(response.status, 401, `cleared counter attempt ${attempt} should fail credentials`);
}

let successLogin: { identifier: string; password: string } | null = null;
const success = await handleAuthSessionPost(
  request(JSON.stringify({ identifier: " Guild ", password: "correct-password" }), {
    "x-forwarded-for": "198.51.100.13",
  }),
  dependencies({
    resolveIdentifier: (identifier) => `${identifier.toLowerCase()}@office.derya.invalid`,
    login: async (identifier, password) => {
      successLogin = { identifier, password };
      return { officeId: "office-guild", role: "ADMIN", canViewWholeOffice: true };
    },
  }),
);
assert.equal(success.status, 200);
const successBody = await responseJson(success);
assert.deepEqual(successBody, {
  ok: true,
  officeId: "office-guild",
  role: "ADMIN",
  canViewWholeOffice: true,
  expiresInSeconds: SESSION_MAX_AGE_SECONDS,
});
assert.deepEqual(successLogin, {
  identifier: "guild@office.derya.invalid",
  password: "correct-password",
});
assert.equal(success.headers.get("cache-control"), "no-store");
assert.equal(success.headers.get("x-content-type-options"), "nosniff");
assert.doesNotMatch(JSON.stringify(successBody), /correct-password|guild@office/);

console.log("Auth session route contract passed.");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
