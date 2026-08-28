import Link from "next/link";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import {
  calculateLeadDiscoveryReport,
  percentage,
  type LeadDiscoveryReportRow,
  type LeadGenReportRun,
} from "@/lib/leadgen/report";

export const metadata = { title: "Lead discovery report" };

function rate(numerator: number, denominator: number) {
  const value = percentage(numerator, denominator);
  return value == null ? "no data yet" : `${value}% (${numerator}/${denominator})`;
}

function dateTime(value: Date) {
  return value.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default async function LeadgenReportPage({ searchParams }: {
  searchParams: Promise<{ days?: string }>;
}) {
  const session = await requireSession();
  if (session.role !== UserRole.ADMIN && session.role !== UserRole.MANAGER) return null;
  const params = await searchParams;
  const parsedDays = Number(params.days);
  const days = Number.isInteger(parsedDays) && parsedDays > 0 && parsedDays <= 365 ? parsedDays : 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [discoveries, runs] = await Promise.all([
    prisma.leadDiscovery.findMany({
      where: { officeId: session.officeId, discoveredAt: { gte: since } },
      select: {
        provider: true,
        engine: true,
        campaignTag: true,
        profileSlug: true,
        persisted: true,
        contactFound: true,
        usableContact: true,
        bestEmailVerdict: true,
      },
    }),
    prisma.leadGenRun.findMany({
      where: { officeId: session.officeId, startedAt: { gte: since } },
      orderBy: { startedAt: "desc" },
      select: {
        profileSlug: true,
        campaignTag: true,
        startedAt: true,
        status: true,
        queriesUsed: true,
        pagesFetched: true,
        candidatesFound: true,
        companiesCreated: true,
        error: true,
        providerStats: true,
      },
    }),
  ]);
  const report = calculateLeadDiscoveryReport(
    discoveries as LeadDiscoveryReportRow[],
    runs as LeadGenReportRun[],
  );

  return (
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: "32px 24px" }}>
      <p><Link href="/dashboard/admin">Admin</Link></p>
      <h1>Lead discovery report</h1>
      <p>Last {days} days, office scope from your session.</p>
      <form method="get" style={{ margin: "20px 0" }}>
        <label>Window (days) <input name="days" type="number" min="1" max="365" defaultValue={days} /></label>
        <button type="submit" style={{ marginLeft: 8 }}>Apply</button>
      </form>

      <h2>By provider</h2>
      {report.providers.length === 0 ? <p>no data yet</p> : (
        <table><thead><tr><th>Provider</th><th>Queries</th><th>Raw hits</th><th>Candidates</th><th>Companies persisted</th><th>Contact rate</th><th>Usable-contact rate</th><th>Deliverable rate</th></tr></thead>
          <tbody>{report.providers.map((item) => <tr key={item.provider}>
            <td>{item.provider}</td><td>{item.queries}</td><td>{item.hits}</td><td>{item.candidates}</td><td>{item.companiesPersisted}</td>
            <td>{rate(item.contactNumerator, item.contactDenominator)}</td>
            <td>{rate(item.usableContactNumerator, item.usableContactDenominator)}</td>
            <td>{rate(item.deliverableNumerator, item.deliverableDenominator)}</td>
          </tr>)}</tbody>
        </table>
      )}

      <h2>By campaign</h2>
      <ProjectTable rows={report.campaigns} />
      <h2>By profile</h2>
      <ProjectTable rows={report.profiles} />

      <h2>Runs</h2>
      {report.runs.length === 0 ? <p>no data yet</p> : (
        <table><thead><tr><th>Started</th><th>Profile</th><th>Campaign</th><th>Status</th><th>Queries</th><th>Pages</th><th>Candidates</th><th>New rows saved</th><th>Error</th></tr></thead>
          <tbody>{report.runs.map((run, index) => <tr key={`${run.startedAt.toISOString()}-${index}`}>
            <td>{dateTime(run.startedAt)}</td><td>{run.profileSlug}</td><td>{run.campaignTag}</td><td>{run.status}</td>
            <td>{run.queriesUsed}</td><td>{run.pagesFetched}</td><td>{run.candidatesFound}</td><td>{run.companiesCreated}</td>
            <td>{run.status === "FAILED" ? run.error ?? "unknown error" : "-"}</td>
          </tr>)}</tbody>
        </table>
      )}
    </main>
  );
}

function ProjectTable({ rows }: { rows: ReturnType<typeof calculateLeadDiscoveryReport>["campaigns"] }) {
  if (rows.length === 0) return <p>no data yet</p>;
  return (
    <table><thead><tr><th>Project</th><th>Queries</th><th>Discoveries</th><th>Companies persisted</th><th>Contact rate</th><th>Usable-contact rate</th></tr></thead>
      <tbody>{rows.map((item) => <tr key={item.key}>
        <td>{item.key}</td><td>{item.queries}</td><td>{item.discoveries}</td><td>{item.companiesPersisted}</td>
        <td>{rate(item.contactNumerator, item.contactDenominator)}</td>
        <td>{rate(item.usableContactNumerator, item.usableContactDenominator)}</td>
      </tr>)}</tbody>
    </table>
  );
}
