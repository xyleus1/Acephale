import type { Metadata } from "next";
import { ArrowRight, Check, LockKeyhole } from "lucide-react";
import { LogoMark } from "@/components/logo-mark";
import styles from "./integrations.module.css";

export const metadata: Metadata = {
  title: { absolute: "Client integrations | Derya" },
  description: "Technical requirements and controls for connecting a client supply system to Derya.",
  alternates: { canonical: "/integrations" },
};

const resources = [
  ["Locations", "Facilities, warehouses, suppliers, ports, and customer sites."],
  ["Items and BOM", "SKUs, part numbers, units, aliases, and component relationships."],
  ["Inventory and demand", "On-hand, allocated, in-transit, open demand, dates, and priority."],
  ["Supply records", "Purchase orders, incumbent supplier terms, lead times, prices, and evidence."],
  ["Compliance", "Authority records, references, constraints, and review state."],
];

const controls = [
  "The first connection is read-only. Derya does not write into the client system.",
  "Every connector and imported record is scoped to the client office and company workspace.",
  "OAuth credentials stay in deployment secrets and are not returned to the browser.",
  "A failed sync keeps the last published snapshot in place.",
  "Supplier contact, orders, bookings, filings, and spend require separate approval-gated workflows.",
];

const requirements = [
  "API documentation and a sandbox base URL",
  "OAuth 2.0 client-credentials access",
  "Resource paths and field definitions",
  "Pagination, rate-limit, and retry behavior",
  "A technical owner for field mapping and acceptance testing",
];

export default function IntegrationsPage() {
  return (
    <div className={styles.page}>
      <header className={styles.siteHeader}>
        <a href="/integrations" className={styles.brand} aria-label="Derya integrations"><LogoMark mini /><strong>Derya</strong></a>
        <a href="/login" className={styles.signIn}>Sign in</a>
      </header>

      <main>
        <section className={styles.intro}>
          <div>
            <p className={styles.sectionLabel}>Client integration contract</p>
            <h1>Connect your supply system to Derya.</h1>
            <p className={styles.lead}>Derya pulls approved supply, demand, inventory, location, and supplier records into a client-scoped workspace. The first integration is read-only.</p>
            <a className={styles.primaryAction} href="mailto:mert@usederya.com?subject=Derya%20client%20integration">Start integration <ArrowRight size={16} /></a>
          </div>
          <aside className={styles.scopePanel}>
            <span><LockKeyhole size={17} /> Connection baseline</span>
            <dl>
              <div><dt>Direction</dt><dd>Client system to Derya</dd></div>
              <div><dt>Authentication</dt><dd>OAuth 2.0 client credentials</dd></div>
              <div><dt>Transport</dt><dd>HTTPS JSON API</dd></div>
              <div><dt>Schedule</dt><dd>Hourly or manual</dd></div>
              <div><dt>Writeback</dt><dd>Not enabled</dd></div>
            </dl>
          </aside>
        </section>

        <section className={styles.section}>
          <header><span>01</span><h2>Data scope</h2></header>
          <div className={styles.resourceRows}>
            {resources.map(([name, detail]) => <div key={name}><strong>{name}</strong><p>{detail}</p></div>)}
          </div>
        </section>

        <section className={styles.section}>
          <header><span>02</span><h2>Connection flow</h2></header>
          <ol className={styles.flow}>
            <li><span>1</span><div><strong>Authenticate</strong><p>Derya requests a bearer token from the client OAuth endpoint.</p></div></li>
            <li><span>2</span><div><strong>Pull</strong><p>Derya reads configured resources and follows cursor pagination.</p></div></li>
            <li><span>3</span><div><strong>Validate</strong><p>Records are normalized and rejected if keys, references, dates, or units are invalid.</p></div></li>
            <li><span>4</span><div><strong>Publish</strong><p>A valid run creates an immutable snapshot. Failed runs do not replace the prior snapshot.</p></div></li>
            <li><span>5</span><div><strong>Review</strong><p>Operators review shortages, supplier records, logistics needs, and approval-gated decisions.</p></div></li>
          </ol>
        </section>

        <section className={styles.technicalSection}>
          <div>
            <p className={styles.sectionLabel}>Response envelope</p>
            <h2>One contract per resource</h2>
            <p>Locations and items are required. Other resource paths can be mapped or disabled for the first release.</p>
          </div>
          <pre aria-label="Connector response example"><code>{`GET /api/v1/items?cursor=page-2
Authorization: Bearer <token>
X-Trace-Id: <trace-id>

{
  "data": [ ... ],
  "nextCursor": "page-3",
  "syncToken": "sync-42",
  "sourceVersion": "client-v42"
}`}</code></pre>
        </section>

        <section className={styles.splitSection}>
          <div>
            <p className={styles.sectionLabel}>Controls</p>
            <h2>Operational boundaries</h2>
            <ul>{controls.map((control) => <li key={control}><Check size={15} />{control}</li>)}</ul>
          </div>
          <div>
            <p className={styles.sectionLabel}>Client checklist</p>
            <h2>What we need</h2>
            <ul>{requirements.map((requirement) => <li key={requirement}><Check size={15} />{requirement}</li>)}</ul>
          </div>
        </section>

        <section className={styles.finalAction}>
          <div><h2>Integration review</h2><p>Send the API documentation and technical owner. Credentials should follow the agreed secure setup process, not email.</p></div>
          <a href="mailto:mert@usederya.com?subject=Derya%20client%20integration">Contact Derya <ArrowRight size={16} /></a>
        </section>
      </main>

      <footer className={styles.siteFooter}><span>Derya</span><span>Client integrations</span></footer>
    </div>
  );
}
