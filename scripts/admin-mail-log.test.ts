import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  EMPTY_MAIL_LOG_FILTER,
  mailLogMessageWhere,
  type MailLogFilter,
} from "../src/lib/admin-mail-log";

const root = process.cwd();

const unfiltered = mailLogMessageWhere("office-1", EMPTY_MAIL_LOG_FILTER, []);
assert.deepEqual(unfiltered, { thread: { officeId: "office-1" } }, "an empty filter must only scope the office");

const sent = mailLogMessageWhere("office-1", { ...EMPTY_MAIL_LOG_FILTER, direction: "OUTBOUND" }, []);
assert.equal(sent.direction, "OUTBOUND");
assert.deepEqual(sent.thread, { officeId: "office-1" }, "direction must not drop office scoping");

const procurement = mailLogMessageWhere("office-1", { ...EMPTY_MAIL_LOG_FILTER, outreach: "Procurement" }, []);
assert.deepEqual(procurement.subject, { contains: "[RFQ " });
assert.equal(procurement.NOT, undefined);

const sales = mailLogMessageWhere("office-1", { ...EMPTY_MAIL_LOG_FILTER, outreach: "Sales" }, []);
assert.deepEqual(
  sales.AND,
  [{ OR: [{ subject: null }, { NOT: { subject: { contains: "[RFQ " } } }] }],
  "Sales must keep mail with no subject, which a bare NOT clause would drop",
);
assert.equal(sales.NOT, undefined);
assert.equal(sales.subject, undefined);

const searchFilter: MailLogFilter = { search: "  foam  ", direction: "ALL", outreach: "ALL" };
const searched = mailLogMessageWhere("office-1", searchFilter, ["e3f6cacc"]);
const clauses = searched.OR;
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
assert.match(serialized, /"thread":\{"officeId":"office-1"/, "the relation clause must stay office scoped");

const combined = mailLogMessageWhere(
  "office-1",
  { search: "foam", direction: "INBOUND", outreach: "Procurement" },
  [],
);
assert.equal(combined.direction, "INBOUND");
assert.deepEqual(combined.subject, { contains: "[RFQ " });
assert.ok(Array.isArray(combined.OR));

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
  /loadMailLog\(session\.officeId, filter\)/,
  "the mail log must stay office scoped and filter inside the query",
);
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
