import assert from "node:assert/strict";
import {
  buildGmailBackfillWindows,
  buildGmailDateWindowQuery,
  buildRecentGmailSyncQuery,
  formatGmailQueryDate,
} from "../src/lib/gmail-sync-windows";

assert.equal(formatGmailQueryDate(new Date(Date.UTC(2026, 5, 29))), "2026/06/29");
assert.equal(buildRecentGmailSyncQuery(14), "newer_than:14d -in:spam -in:trash");
assert.equal(
  buildGmailDateWindowQuery({ after: "2026/06/01", before: "2026/07/01" }),
  "after:2026/06/01 before:2026/07/01 -in:spam -in:trash",
);

const windows = buildGmailBackfillWindows({
  monthsBack: 3,
  now: new Date(Date.UTC(2026, 5, 29)),
});
assert.deepEqual(
  windows.map((window) => ({ label: window.label, after: window.after, before: window.before })),
  [
    { label: "2026-06", after: "2026/06/01", before: "2026/07/01" },
    { label: "2026-05", after: "2026/05/01", before: "2026/06/01" },
    { label: "2026-04", after: "2026/04/01", before: "2026/05/01" },
  ],
);

console.log("gmail-sync-windows ok");
