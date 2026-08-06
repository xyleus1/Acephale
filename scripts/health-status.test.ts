import assert from "node:assert/strict";
import { classifyHealthChecks, type HealthCheck } from "../src/lib/health-status";

function check(
  name: string,
  ok: boolean,
  severity: HealthCheck["severity"],
): HealthCheck {
  return { name, ok, severity };
}

const healthy = classifyHealthChecks([
  check("db_ping", true, "critical"),
  check("backgroundJob_backlog", true, "warning"),
]);
assert.deepEqual(healthy, {
  ok: true,
  status: "healthy",
  httpStatus: 200,
});

const degraded = classifyHealthChecks([
  check("db_ping", true, "critical"),
  check("backgroundJob_backlog", false, "warning"),
]);
assert.deepEqual(degraded, {
  ok: true,
  status: "degraded",
  httpStatus: 200,
});

const unhealthy = classifyHealthChecks([
  check("db_ping", false, "critical"),
  check("backgroundJob_backlog", true, "warning"),
]);
assert.deepEqual(unhealthy, {
  ok: false,
  status: "unhealthy",
  httpStatus: 500,
});

console.log("Health status tests passed.");
