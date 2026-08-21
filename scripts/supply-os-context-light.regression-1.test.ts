// Regression: ISSUE-001 - Context ignored the light app design tokens.
// Found by /qa on 2026-08-20
// Report: .gstack/qa-reports/qa-report-app-derya-ai-2026-08-20.md

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(
  resolve(process.cwd(), "src/app/dashboard/supply-os/supply-os-context.module.css"),
  "utf8",
);

assert.match(css, /--chat-canvas: #f7f8f7/);
assert.match(css, /--chat-surface: #ffffff/);
assert.match(css, /--chat-ink: #1b1d1c/);
assert.match(css, /--chat-muted: #747c78/);
assert.match(css, /background: var\(--chat-surface\)/);
assert.doesNotMatch(css, /#212121|#2f2f2f|#383838|#171717|#ececec|#a6a6a6/i);
assert.equal(css.includes("\u2014"), false);

console.log("Supply OS Context light-theme regression passed.");
