import {
  HARDWARE_VC_OUTREACH_CAMPAIGN,
  hardwareVcCampaignCounts,
  hardwareVcCampaignNotes,
  linkedinPeopleSearchUrl,
} from "../src/lib/hardware-vc-outreach-campaign";

let failures = 0;

function check(name: string, ok: boolean) {
  if (ok) {
    console.log(`ok - ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL - ${name}`);
  }
}

const counts = hardwareVcCampaignCounts();
const uniquePeople = new Set(
  HARDWARE_VC_OUTREACH_CAMPAIGN.map(
    (target) => `${target.company}:${target.name}`.toLowerCase(),
  ),
);
const renderedCampaign = JSON.stringify(HARDWARE_VC_OUTREACH_CAMPAIGN);

check("campaign has exactly 80 people", HARDWARE_VC_OUTREACH_CAMPAIGN.length === 80);
check("campaign people are unique within each fund", uniquePeople.size === 80);
check("campaign has 20 Bookface targets", counts.bookface === 20);
check("campaign has 30 LinkedIn targets", counts.linkedin === 30);
check("campaign has 30 email targets", counts.email === 30);
check(
  "every target has an official HTTPS source",
  HARDWARE_VC_OUTREACH_CAMPAIGN.every(
    (target) => target.sourceUrl.startsWith("https://") && target.website.startsWith("https://"),
  ),
);
check(
  "every email target explicitly leaves email discovery to the operator",
  HARDWARE_VC_OUTREACH_CAMPAIGN
    .filter((target) => target.channel === "email")
    .every((target) => hardwareVcCampaignNotes(target).includes("Email needed.")),
);
check(
  "non-Bookface targets have deterministic LinkedIn people searches",
  HARDWARE_VC_OUTREACH_CAMPAIGN
    .filter((target) => target.channel !== "bookface")
    .every((target) =>
      linkedinPeopleSearchUrl(target).startsWith(
        "https://www.linkedin.com/search/results/people/?keywords=",
      ),
    ),
);
check(
  "campaign includes the core hardware investor networks",
  ["Y Combinator", "SOSV / HAX", "DCVC", "Lux Capital", "Root Ventures", "Construct Capital"]
    .every((company) =>
      HARDWARE_VC_OUTREACH_CAMPAIGN.some((target) => target.company === company),
    ),
);
check("campaign contains no prohibited em dash", !renderedCampaign.includes("\u2014"));

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}

console.log("hardware-vc-outreach.test.ts passed");
