import assert from "node:assert/strict";
import { test } from "node:test";
import { archiveUrl } from "./import_archive";
test("v5 archives only connect to the explicit local research database", () => {
  assert(archiveUrl("postgresql://goalspec_owner@127.0.0.1:55440/goalspec_research").includes("goalspec_research"));
  for (const url of ["postgresql://local@127.0.0.1:55440/goalspec_derya_v5_test", "postgresql://local@remote.invalid:55440/goalspec_research", "postgresql://local@127.0.0.1:5432/goalspec_research", "postgresql://local@127.0.0.1:55440/goalspec_research?schema=public"]) assert.throws(() => archiveUrl(url));
  const url = "postgresql://local@127.0.0.1:55440/goalspec_research";
  assert.throws(() => archiveUrl(url, url));
});
