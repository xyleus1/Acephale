export type HardwareVcOutreachChannel = "bookface" | "linkedin" | "email";

export type HardwareVcOutreachTarget = {
  name: string;
  title: string;
  company: string;
  website: string;
  sourceUrl: string;
  focus: string;
  channel: HardwareVcOutreachChannel;
  importance: "critical" | "high";
};

type Person = readonly [
  name: string,
  title: string,
  importance?: HardwareVcOutreachTarget["importance"],
];

function fundTargets(input: {
  company: string;
  website: string;
  sourceUrl: string;
  focus: string;
  channel: HardwareVcOutreachChannel;
  people: readonly Person[];
}): HardwareVcOutreachTarget[] {
  return input.people.map(([name, title, importance = "high"]) => ({
    name,
    title,
    company: input.company,
    website: input.website,
    sourceUrl: input.sourceUrl,
    focus: input.focus,
    channel: input.channel,
    importance,
  }));
}

export const HARDWARE_VC_OUTREACH_CAMPAIGN: readonly HardwareVcOutreachTarget[] = [
  ...fundTargets({
    company: "Y Combinator",
    website: "https://www.ycombinator.com/",
    sourceUrl: "https://www.ycombinator.com/people",
    focus: "YC hardware, robotics, industrial, mobility, and supply-chain founders.",
    channel: "bookface",
    people: [
      ["Garry Tan", "President and CEO", "critical"],
      ["Gustaf Alstromer", "General Partner", "critical"],
      ["Harshita Arora", "General Partner", "critical"],
      ["Grey Baker", "General Partner"],
      ["Tom Blomfield", "General Partner"],
      ["Tyler Bosmeny", "General Partner"],
      ["Nicolas Dessaigne", "General Partner"],
      ["Aaron Epstein", "General Partner"],
      ["Brad Flora", "General Partner"],
      ["Jared Friedman", "Managing Partner", "critical"],
      ["Chris Golda", "General Partner", "critical"],
      ["Ankit Gupta", "General Partner", "critical"],
      ["Diana Hu", "Managing Partner", "critical"],
      ["Pete Koomen", "General Partner"],
      ["David Lieb", "General Partner"],
      ["Andrew Miklas", "General Partner"],
      ["Harj Taggar", "Managing Partner", "critical"],
      ["Jon Xu", "General Partner"],
    ],
  }),
  ...fundTargets({
    company: "Fifty Years",
    website: "https://fiftyyears.com/",
    sourceUrl: "https://fiftyyears.com/team-1",
    focus: "Deep-tech founders in industrial systems, robotics, climate, space, and physical infrastructure.",
    channel: "bookface",
    people: [
      ["Seth Bannon", "Founding Partner and YC alum", "critical"],
      ["Ela Madej", "Founding Partner and YC alum", "critical"],
    ],
  }),
  ...fundTargets({
    company: "DCVC",
    website: "https://www.dcvc.com/",
    sourceUrl: "https://www.dcvc.com/team/",
    focus: "Deep-tech companies commercializing hardware, industrial systems, robotics, and infrastructure.",
    channel: "linkedin",
    people: [
      ["Matt Ocko", "Co-Founder and Managing Partner", "critical"],
      ["Zachary Bogue", "Co-Founder and Managing Partner", "critical"],
      ["James Hardiman", "General Partner"],
      ["Rachel Slaybaugh", "General Partner", "critical"],
      ["Milo Werner", "General Partner"],
      ["Ali Tamaseb", "General Partner"],
    ],
  }),
  ...fundTargets({
    company: "Lux Capital",
    website: "https://www.luxcapital.com/",
    sourceUrl: "https://www.luxcapital.com/people",
    focus: "Frontier science and engineering companies with complex hardware and supply chains.",
    channel: "linkedin",
    people: [
      ["Peter Hebert", "Partner and Co-Founder", "critical"],
      ["Josh Wolfe", "Partner and Co-Founder", "critical"],
      ["Shahin Farshchi", "Partner", "critical"],
      ["Brandon Reeves", "Partner"],
      ["Deena Shakir", "Partner"],
      ["Grace Isford", "Partner"],
    ],
  }),
  ...fundTargets({
    company: "Root Ventures",
    website: "https://root.vc/",
    sourceUrl: "https://root.vc/welcome.htm",
    focus: "Seed-stage hard-tech founders building robotics, manufacturing, and physical systems.",
    channel: "linkedin",
    people: [
      ["Avidan Ross", "Managing Partner", "critical"],
      ["Kane Hsieh", "Partner", "critical"],
      ["Chrissy Meyer", "Partner"],
    ],
  }),
  ...fundTargets({
    company: "Playground Global",
    website: "https://www.playground.vc/",
    sourceUrl: "https://www.playground.vc/people",
    focus: "Deep-tech and industrial portfolio companies moving physical products and equipment.",
    channel: "linkedin",
    people: [
      ["Peter Barrett", "General Partner", "critical"],
      ["Jory Bell", "General Partner", "critical"],
      ["Pat Gelsinger", "General Partner", "critical"],
      ["Bruce Leak", "General Partner", "critical"],
      ["Benjamin Kim", "Partner"],
      ["Matt Hershenson", "Venture Partner"],
      ["Sasha Ostojic", "Venture Partner"],
      ["Laurie Yoler", "Venture Partner"],
    ],
  }),
  ...fundTargets({
    company: "SOSV / HAX",
    website: "https://sosv.com/hax/",
    sourceUrl: "https://sosv.com/team/",
    focus: "HAX and SOSV hardware founders with manufacturing, China, cross-border, and freight needs.",
    channel: "linkedin",
    people: [
      ["Cyril Ebersweiler", "General Partner and HAX Managing Director", "critical"],
      ["Duncan Turner", "General Partner and HAX Managing Director", "critical"],
      ["Avra van der Zee", "General Partner"],
      ["Susan Schofer", "Partner and Chief Science Officer"],
      ["Ji Ke", "Partner and HAX CTO", "critical"],
      ["Andrew Gollach", "Partner"],
      ["Sean O'Sullivan", "Managing General Partner", "critical"],
    ],
  }),
  ...fundTargets({
    company: "Construct Capital",
    website: "https://www.constructcap.com/",
    sourceUrl: "https://www.constructcap.com/",
    focus: "Founders transforming manufacturing, supply chain, logistics, and industrial operations.",
    channel: "email",
    people: [
      ["Dayna Grayson", "Co-Founder and Managing Partner", "critical"],
      ["Rachel Holt", "Co-Founder and Managing Partner", "critical"],
    ],
  }),
  ...fundTargets({
    company: "Prime Movers Lab",
    website: "https://www.primemoverslab.com/",
    sourceUrl: "https://www.primemoverslab.com/team/",
    focus: "Breakthrough science and industrial companies that ship specialized hardware and equipment.",
    channel: "email",
    people: [
      ["Dakin Sloss", "Founder and General Partner", "critical"],
      ["Zia Huque", "General Partner", "critical"],
      ["Gavin Mathis", "Partner and Chief of Staff"],
      ["Roger Carter", "VP of Engineering"],
      ["JJ Moi", "Design Partner"],
      ["Amy Kruse", "Venture Partner"],
    ],
  }),
  ...fundTargets({
    company: "Energy Impact Partners",
    website: "https://www.energyimpactpartners.com/",
    sourceUrl: "https://www.energyimpactpartners.com/team/",
    focus: "Climate, electrification, energy, mobility, and industrial portfolio companies with physical supply chains.",
    channel: "email",
    people: [
      ["Hans Kobler", "Founder and Managing Partner", "critical"],
      ["Lindsay Luger", "Co-Founder and Partner", "critical"],
      ["Sameer Reddy", "Managing Partner, Flagship", "critical"],
      ["Cassie Bowe", "Partner"],
      ["Shayle Kann", "Managing Partner, Frontier"],
    ],
  }),
  ...fundTargets({
    company: "Schematic Ventures",
    website: "https://www.schematicventures.com/",
    sourceUrl: "https://www.schematicventures.com/",
    focus: "Supply-chain, logistics, manufacturing, and commerce infrastructure founders.",
    channel: "email",
    people: [["Julian Counihan", "General Partner", "critical"]],
  }),
  ...fundTargets({
    company: "Ironspring Ventures",
    website: "https://ironspring.com/",
    sourceUrl: "https://ironspring.com/team/",
    focus: "Industrial supply chain, construction, manufacturing, and logistics technology founders.",
    channel: "email",
    people: [
      ["Ty Findley", "Co-Founder and General Partner", "critical"],
      ["Peter J. Holt", "Co-Founder and General Partner", "critical"],
      ["Natan Reddy", "Principal"],
      ["Drew Kriens", "Principal"],
      ["Charlie Kirn", "Investor"],
    ],
  }),
  ...fundTargets({
    company: "Dynamo Ventures",
    website: "https://dynamo.vc/",
    sourceUrl: "https://dynamo.vc/about",
    focus: "Supply-chain and mobility founders who can introduce hardware exporters and importers.",
    channel: "email",
    people: [
      ["Santosh Sankar", "Co-Founder and Managing Partner", "critical"],
      ["Jon Bradford", "Co-Founder and Managing Partner", "critical"],
      ["Ted Alling", "Co-Founder and Partner"],
      ["Barry Large", "Co-Founder and Partner"],
    ],
  }),
  ...fundTargets({
    company: "Autotech Ventures",
    website: "https://www.autotechvc.com/",
    sourceUrl: "https://www.autotechvc.com/team",
    focus: "Mobility, transportation, automotive, logistics, and industrial hardware companies.",
    channel: "email",
    people: [
      ["Quin Garcia", "Investment Team", "critical"],
      ["Alexei Andreev", "Investment Team", "critical"],
      ["Maurice Gunderson", "Investment Team"],
      ["Burak Cendek", "Investment Team"],
    ],
  }),
  ...fundTargets({
    company: "Material Impact",
    website: "https://www.materialimpact.com/",
    sourceUrl: "https://www.materialimpact.com/team/",
    focus: "Materials, manufacturing, climate, and deep-tech companies with specialized logistics requirements.",
    channel: "email",
    people: [
      ["Carmichael Roberts", "Co-Founder and Managing Partner", "critical"],
      ["Adam Sharkawy", "Co-Founder and Managing Partner", "critical"],
      ["Corinna Chen", "Partner"],
    ],
  }),
];

export const HARDWARE_VC_CAMPAIGN_TAG = "hardware_vc_portfolio_intro_2026_07_27";
export const HARDWARE_VC_CAMPAIGN_REVIEWED_AT = "2026-07-27";

export function hardwareVcCampaignCounts(): Record<HardwareVcOutreachChannel, number> {
  return HARDWARE_VC_OUTREACH_CAMPAIGN.reduce(
    (counts, target) => {
      counts[target.channel] += 1;
      return counts;
    },
    { bookface: 0, linkedin: 0, email: 0 },
  );
}

export function linkedinPeopleSearchUrl(target: HardwareVcOutreachTarget): string {
  const keywords = encodeURIComponent(`${target.name} ${target.company}`);
  return `https://www.linkedin.com/search/results/people/?keywords=${keywords}`;
}

export function hardwareVcCampaignNotes(target: HardwareVcOutreachTarget): string {
  const route =
    target.channel === "bookface"
      ? `Search Bookface for ${target.name}.`
      : target.channel === "email"
        ? "Email needed. Use the LinkedIn search and official team page to verify the address."
        : "Use the LinkedIn search link and verify the exact profile before sending.";
  return [
    "Hardware VC portfolio-intro target.",
    `Why: ${target.focus}`,
    "Ask: request 2-3 introductions to portfolio founders importing hardware, manufacturing in Asia, or needing U.S. freight support.",
    route,
    `Official source: ${target.sourceUrl}`,
    `Reviewed: ${HARDWARE_VC_CAMPAIGN_REVIEWED_AT}.`,
    `Campaign: ${HARDWARE_VC_CAMPAIGN_TAG}.`,
  ].join(" ");
}
