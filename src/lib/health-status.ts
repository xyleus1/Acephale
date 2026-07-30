export type HealthCheckSeverity = "critical" | "warning";

export type HealthCheck = {
  name: string;
  ok: boolean;
  severity: HealthCheckSeverity;
  detail?: string;
};

export type HealthStatus = {
  ok: boolean;
  status: "healthy" | "degraded" | "unhealthy";
  httpStatus: 200 | 500;
};

export function classifyHealthChecks(checks: HealthCheck[]): HealthStatus {
  const criticalOk = checks
    .filter((check) => check.severity === "critical")
    .every((check) => check.ok);
  const allOk = checks.every((check) => check.ok);

  if (!criticalOk) {
    return { ok: false, status: "unhealthy", httpStatus: 500 };
  }

  return {
    ok: true,
    status: allOk ? "healthy" : "degraded",
    httpStatus: 200,
  };
}
