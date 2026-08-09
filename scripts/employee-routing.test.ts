import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { middleware } from "../src/middleware";

const secret = "employee-routing-test-secret";
process.env.AUTH_SECRET = secret;

function sessionToken(role: string) {
  const payload = Buffer.from(JSON.stringify({ role })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

function request(pathname: string, token?: string) {
  return new NextRequest(`https://app.example${pathname}`, {
    headers: token ? { cookie: `crm_session=${token}` } : undefined,
  });
}

function assertNext(response: Response) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-middleware-next"), "1");
}

async function main() {
  const employeeToken = sessionToken("EMPLOYEE");

  assertNext(await middleware(request("/dashboard/loads", employeeToken)));
  assertNext(await middleware(request("/dashboard/loads/active", employeeToken)));

  const jobResponse = await middleware(
    request("/dashboard/jobs/job_123", employeeToken),
  );
  assertNext(jobResponse);
  assert.equal(jobResponse.cookies.get("focus-job")?.value, "job_123");

  for (const blockedPath of [
    "/dashboard",
    "/dashboard/rfq",
    "/dashboard/pricing",
    "/dashboard/jobs/new",
    "/dashboard/jobs/new/from-rfq",
  ]) {
    const response = await middleware(request(blockedPath, employeeToken));
    assert.equal(response.status, 307, `${blockedPath} must redirect`);
    assert.equal(
      new URL(response.headers.get("location") ?? "https://invalid.example").pathname,
      "/dashboard/loads",
    );
  }

  assertNext(await middleware(request("/dashboard", sessionToken("ADMIN"))));
  assertNext(await middleware(request("/dashboard", "malformed.cookie")));
  assertNext(await middleware(request("/dashboard")));

  console.log("employee routing checks passed");
}

void main();
