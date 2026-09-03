import assert from "node:assert/strict";

async function main() {
  const {
    applyCampaignOverrides,
    classifyCampaign,
    readCampaignPlan,
    CAMPAIGN_TARGET_MAX,
    CAMPAIGN_TARGET_MIN,
  } = await import("../src/lib/procurement-campaign-class");
  const { campaignConvergence } = await import("../src/lib/procurement-campaign-convergence");

  const aerospace = classifyCampaign({
    material: "Aerospace machined bracket",
    specification: `AS9100 and ITAR controlled build with ±0.01 mm tolerance. ${"Detailed requirement ".repeat(100)}`,
    quantity: "12 units",
  });
  assert.equal(aerospace.classKey, "narrow-high-value");
  assert.ok(aerospace.reasons.includes("Aerospace"));
  assert.ok(aerospace.reasons.includes("AS9100"));
  assert.ok(aerospace.reasons.includes("ITAR"));

  const commodity = classifyCampaign({
    material: "corrugated cartons",
    specification: "Standard shipping cartons",
    quantity: "50,000 pieces",
  });
  assert.equal(commodity.classKey, "broad-commodity");

  const specialist = classifyCampaign({
    material: "PCBA",
    specification: "4 layer board, ENIG finish, IPC-A-610 Class 2",
    quantity: 500,
  });
  assert.equal(specialist.classKey, "specialist");

  const overridden = applyCampaignOverrides(specialist, {
    targetGoodCompanies: 2_000,
    quoteGoal: 0,
  });
  assert.equal(overridden.targetGoodCompanies, CAMPAIGN_TARGET_MAX);
  assert.equal(overridden.quoteGoal, 1);
  const lower = applyCampaignOverrides(specialist, {
    targetGoodCompanies: 1,
    quoteGoal: 100,
  });
  assert.equal(lower.targetGoodCompanies, CAMPAIGN_TARGET_MIN);
  assert.equal(lower.quoteGoal, 50);

  assert.equal(readCampaignPlan(null), null);
  assert.equal(readCampaignPlan({ ...specialist, reasons: ["ok", 2] }), null);
  assert.equal(readCampaignPlan({ ...specialist, targetGoodCompanies: 1 }), null);

  assert.deepEqual(
    campaignConvergence(
      { ...specialist, targetGoodCompanies: 20, quoteGoal: 5 },
      { goodLeads: 20, quotesRecorded: 5, discoveryExhausted: false },
    ),
    { done: true, reason: "quote_goal_reached", remainingGoodLeads: 0 },
  );
  assert.deepEqual(
    campaignConvergence(
      { ...specialist, targetGoodCompanies: 20, quoteGoal: 50 },
      { goodLeads: 2, quotesRecorded: 0, discoveryExhausted: true },
    ),
    { done: true, reason: "discovery_exhausted", remainingGoodLeads: 0 },
  );
  assert.deepEqual(
    campaignConvergence(
      { ...specialist, targetGoodCompanies: 20, quoteGoal: 50 },
      { goodLeads: 2, quotesRecorded: 0, discoveryExhausted: false },
    ),
    { done: false, reason: "collecting", remainingGoodLeads: 18 },
  );

  console.log("Procurement campaign class checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
