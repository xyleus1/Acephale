import {
  classifyMarketAffectedEntity,
  isKnownFreightLocation,
  isValidMarketLane,
  normalizeMarketLane,
  rejectBoilerplateLaneCandidate,
} from "../src/lib/market-intelligence/lane-validation";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function main() {
  const valid = [
    ["CN -> EU", "China -> Europe"],
    ["Shanghai to Hamburg", "Shanghai -> Hamburg"],
    ["Ningbo → Rotterdam", "Ningbo -> Rotterdam"],
    ["Suez Canal -> Rotterdam", "Suez Canal -> Rotterdam"],
    ["Turkey -> Europe", "Turkey -> Europe"],
  ];
  for (const [input, expected] of valid) {
    assert(isValidMarketLane(input), `${input} should be a valid freight lane.`);
    assert(normalizeMarketLane(input) === expected, `${input} should normalize to ${expected}.`);
  }

  const invalid = [
    "Countdown -> America",
    "Welcome -> U.S. Customs and Border",
    "Messaging Service Welcome -> U.S. Customs and Border",
    "Updates -> Drawback Bond Validations",
    "Electronic Export -> ACE CATAIR Error",
    "linkedin.com/company/port-of-long-beach -> North America",
    "News -> Archive",
  ];
  for (const input of invalid) {
    assert(!isValidMarketLane(input), `${input} should not be a freight lane.`);
    assert(rejectBoilerplateLaneCandidate(input), `${input} should be rejected as boilerplate/chrome.`);
  }

  assert(isKnownFreightLocation("Port of Long Beach"), "Known port should resolve.");
  assert(!isKnownFreightLocation("Welcome"), "Boilerplate should not resolve as geography.");

  const country = classifyMarketAffectedEntity("U.S. Customs and Border Protection");
  assert(country.kind === "location" && country.label === "US", "CBP should classify as U.S. country/compliance context.");

  const lane = classifyMarketAffectedEntity("Shanghai to Hamburg");
  assert(lane.kind === "lane" && lane.label === "Shanghai -> Hamburg", "Real port pair should classify as lane.");

  console.log(JSON.stringify({
    ok: true,
    valid: valid.map(([input]) => ({ input, normalized: normalizeMarketLane(input) })),
    rejected: invalid,
    cbpContext: country,
  }, null, 2));
}

main();
