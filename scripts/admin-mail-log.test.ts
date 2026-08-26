import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  EMPTY_MAIL_LOG_FILTER,
  mailLogMessageWhere,
  UNROUTED_COMPANY_FILTER,
  type MailLogFilter,
  type MailLogScope,
} from "../src/lib/admin-mail-log";
import { UNROUTED_MAIL_THREAD_MARKER } from "../src/lib/inbound-mail-routing";

const root = process.cwd();
const office: MailLogScope = { kind: "OFFICE", officeId: "office-1" };
const allOffices: MailLogScope = { kind: "ALL_OFFICES" };
const officeThread = {
  officeId: "office-1",
  NOT: { autoLinkSkipReason: UNROUTED_MAIL_THREAD_MARKER },
};

const unfiltered = mailLogMessageWhere(office, EMPTY_MAIL_LOG_FILTER, []);
assert.deepEqual(
  unfiltered,
  { thread: officeThread },
  "an office reader must stay scoped to its office and never see unrouted mail",
);

const unified = mailLogMessageWhere(allOffices, EMPTY_MAIL_LOG_FILTER, []);
assert.deepEqual(unified, {}, "an administrator reads every company in one query");

const unroutedOnly = mailLogMessageWhere(
  allOffices,
  { ...EMPTY_MAIL_LOG_FILTER, company: UNROUTED_COMPANY_FILTER },
  [],
);
assert.deepEqual(
  unroutedOnly.AND,
  [{ thread: { autoLinkSkipReason: UNROUTED_MAIL_THREAD_MARKER } }],
  "the unrouted company filter must select shared-mailbox mail that matched no customer",
);

const byCompany = mailLogMessageWhere(
  allOffices,
  { ...EMPTY_MAIL_LOG_FILTER, company: "HypnoDreamz" },
  [],
  ["e3f6cacc"],
);
const companyClauses = JSON.stringify(byCompany.AND);
assert.match(companyClauses, /"name":\{"equals":"HypnoDreamz","mode":"insensitive"\}/);
assert.match(
  companyClauses,
  /"contains":"\[RFQ e3f6cacc\]"/,
  "a company filter must also match sourcing requests owned by that company",
);

const sent = mailLogMessageWhere(office, { ...EMPTY_MAIL_LOG_FILTER, direction: "OUTBOUND" }, []);
assert.equal(sent.direction, "OUTBOUND");
assert.deepEqual(sent.thread, officeThread, "direction must not drop office scoping");

const procurement = mailLogMessageWhere(office, { ...EMPTY_MAIL_LOG_FILTER, outreach: "Procurement" }, []);
assert.deepEqual(procurement.subject, { contains: "[RFQ " });
assert.equal(procurement.NOT, undefined);

const sales = mailLogMessageWhere(office, { ...EMPTY_MAIL_LOG_FILTER, outreach: "Sales" }, []);
assert.deepEqual(
  sales.AND,
  [{ OR: [{ subject: null }, { NOT: { subject: { contains: "[RFQ " } } }] }],
  "Sales must keep mail with no subject, which a bare NOT clause would drop",
);
assert.equal(sales.NOT, undefined);
assert.equal(sales.subject, undefined);

const searchFilter: MailLogFilter = { search: "  foam  ", direction: "ALL", outreach: "ALL", company: "" };
const searched = mailLogMessageWhere(office, searchFilter, ["e3f6cacc"]);
const clauses = Array.isArray(searched.AND) ? searched.AND[0]?.OR : undefined;
assert.ok(Array.isArray(clauses), "a search must build OR clauses inside the query");
const serialized = JSON.stringify(clauses);
assert.match(serialized, /"subject":\{"contains":"foam","mode":"insensitive"\}/, "search must be trimmed");
assert.match(serialized, /"fromEmail"/);
assert.match(serialized, /"toEmails"/);
assert.match(serialized, /"account":\{"email"/);
assert.match(serialized, /"company":\{"name"/);
assert.match(
  serialized,
  /"contains":"\[RFQ e3f6cacc\]"/,
  "a company or line item match in the workflow database must widen the query by RFQ reference",
);
assert.deepEqual(searched.thread, officeThread, "a search must stay inside the office scope");

const combined = mailLogMessageWhere(
  office,
  { search: "foam", direction: "INBOUND", outreach: "Procurement", company: "" },
  [],
);
assert.equal(combined.direction, "INBOUND");
assert.deepEqual(combined.subject, { contains: "[RFQ " });
assert.ok(Array.isArray(combined.AND));

const settingsHeader = readFileSync(
  resolve(root, "src/app/dashboard/settings/settings-header.tsx"),
  "utf8",
);
assert.match(settingsHeader, /href="\/dashboard\/settings\/log"/, "Settings must expose the mail log tab");
assert.match(settingsHeader, />\s*Log\s*</, "the mail log tab must be labelled Log");
assert.doesNotMatch(settingsHeader, /Channels/, "the Channels tab must stay deleted");

const logPage = readFileSync(resolve(root, "src/app/dashboard/settings/log/page.tsx"), "utf8");
assert.match(logPage, /requireMailLogSession/, "the mail log must stay gated by the mail log access level");

const emailAccountPolicy = readFileSync(resolve(root, "src/lib/email-account-policy.ts"), "utf8");
assert.match(
  emailAccountPolicy,
  /canReadMailLog[\s\S]{0,160}"MANAGER"/,
  "managers must keep the mail log access they had in the admin Activity area",
);
assert.match(
  emailAccountPolicy,
  /canManageEmailAccounts[\s\S]{0,80}role === "ADMIN";/,
  "mailbox management must stay admin only",
);
assert.match(
  logPage,
  /loadMailLog\(scope, filter\)/,
  "the mail log must filter inside the query",
);
assert.match(
  logPage,
  /isAdmin[\s\S]{0,120}ALL_OFFICES[\s\S]{0,120}officeId: session\.officeId/,
  "administrators read every company while other roles stay office scoped",
);
assert.match(logPage, /name="company"/, "the log must offer a company filter");
assert.doesNotMatch(logPage, /\.filter\(\(entry\) => matches/, "filtering must not run over a truncated page");
assert.match(logPage, /entry\.procurementLink/, "the mail log must deep link into procurement messages");

const logStyles = readFileSync(
  resolve(root, "src/app/dashboard/settings/log/log-settings.module.css"),
  "utf8",
);
assert.match(
  logStyles,
  /@media \(max-width: 1080px\)/,
  "the mail log must collapse below the width its column grid needs",
);
assert.match(
  logStyles,
  /\[data-label\]::before[\s\S]{0,220}content: attr\(data-label\)/,
  "collapsed rows must label their own cells once the header row is hidden",
);
assert.match(
  logPage,
  /data-label="Line item"/,
  "the collapsed row labels come from the markup, not the hidden header row",
);

const adminPage = readFileSync(resolve(root, "src/app/dashboard/admin/page.tsx"), "utf8");
assert.doesNotMatch(adminPage, /loadMailLog|MailLogEntry/, "the admin page must not duplicate the mail log");
assert.match(
  adminPage,
  /tab === "mail"[\s\S]{0,80}redirect\("\/dashboard\/settings\/log"\)/,
  "the legacy admin mail tab must redirect to the Settings log",
);

console.log("Admin mail log contract passed.");
