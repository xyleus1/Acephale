import assert from "node:assert/strict";
import {
  campaignIntroEvidence,
  generateCampaignIntro,
  guardCampaignIntro,
} from "../src/lib/outreach-campaign-intro";

const evidence = campaignIntroEvidence({
  company: "Baker House",
  town: "Bath",
  county: "Somerset",
  segment: "tea_room",
  website: "https://www.baker-house.example",
  matched_signals: "brunch",
  google_rating: 4.8,
  google_reviews: 123,
});

assert.equal(evidence.website, "baker-house.example");
assert.equal(evidence.segment_label, "tea room");
assert.equal(guardCampaignIntro("A lovely spot in Bath.", evidence, ["town"]), "A lovely spot in Bath.");
assert.equal(guardCampaignIntro("Rated 4.9 in Bath.", evidence, ["town"]), "");
assert.equal(guardCampaignIntro("I noticed your cafe.", evidence, ["town"]), "");
assert.equal(guardCampaignIntro("A lovely spot in Bath!", evidence, ["town"]), "");
assert.equal(guardCampaignIntro("A lovely spot in 999 Oxford.", evidence, ["town"]), "");
assert.equal(guardCampaignIntro("A lovely spot with 23 reviews in Bath.", evidence, ["town"]), "");
assert.equal(guardCampaignIntro("A lovely spot in Bath. Your team is welcoming.", evidence, ["town"]), "A lovely spot in Bath. Your team is welcoming.");
assert.equal(guardCampaignIntro("A lovely spot in Bath. A second sentence. A third sentence.", evidence, ["town"]), "");
assert.equal(guardCampaignIntro("A lovely spot in Bath - warm and welcoming.", evidence, ["town"]), "A lovely spot in Bath - warm and welcoming.");
assert.equal(guardCampaignIntro("A lovely spot in Bath.", evidence, ["segment_label"]), "A lovely spot in Bath.");
assert.equal(guardCampaignIntro("An award-winning cafe in Bath.", evidence, ["town"]), "");
assert.equal(guardCampaignIntro("Try our sourdough in Bath.", evidence, ["town"]), "");
assert.equal(guardCampaignIntro("Since 1987, a lovely spot in Bath.", evidence, ["town"]), "");
assert.equal(guardCampaignIntro("Matt runs a lovely spot in Bath.", evidence, ["town"]), "");
assert.equal(guardCampaignIntro("A dog friendly garden in Bath.", evidence, ["town"]), "");

async function main() {
  const calls: Array<{ pitch: string }> = [];
  const intro = await generateCampaignIntro({
    evidence,
    pitch: "We help independent cafes simplify dessert supply.",
    llm: {
      generate: async (input) => {
        calls.push({ pitch: input.pitch });
        return { intro: "Bath's independent cafe scene is well represented here.", used: ["town", "segment_label"] };
      },
    },
  });
  assert.equal(intro, "Bath's independent cafe scene is well represented here.");
  assert.equal(calls.length, 1);
}

void main();
