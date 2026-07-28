export type HardwareVcOutreachChannel = "bookface" | "linkedin" | "email";
export type HardwareOutreachTargetKind = "hardware_company" | "hardware_vc";

export type HardwareVcOutreachTarget = {
  name: string;
  title: string;
  company: string;
  website: string;
  sourceUrl: string;
  focus: string;
  channel: HardwareVcOutreachChannel;
  kind: HardwareOutreachTargetKind;
  importance: "critical" | "high";
};

type Person = readonly [
  name: string,
  title: string,
  importance?: HardwareVcOutreachTarget["importance"],
];

type TargetGroup = {
  company: string;
  website: string;
  sourceUrl: string;
  focus: string;
  channel: HardwareVcOutreachChannel;
  kind: HardwareOutreachTargetKind;
  people: readonly Person[];
};

function groupTargets(input: TargetGroup): HardwareVcOutreachTarget[] {
  return input.people.map(([name, title, importance = "high"]) => ({
    name,
    title,
    company: input.company,
    website: input.website,
    sourceUrl: input.sourceUrl,
    focus: input.focus,
    channel: input.channel,
    kind: input.kind,
    importance,
  }));
}

const BOOKFACE_HARDWARE_COMPANIES: readonly TargetGroup[] = [
  {
    company: "Astranis",
    website: "https://www.astranis.com/",
    sourceUrl: "https://www.ycombinator.com/companies/astranis",
    focus: "Builds and operates satellites from a large San Francisco manufacturing footprint.",
    channel: "bookface",
    kind: "hardware_company",
    people: [["John Gedmark", "Founder and CEO", "critical"]],
  },
  {
    company: "Gecko Robotics",
    website: "https://www.geckorobotics.com/",
    sourceUrl: "https://www.ycombinator.com/companies/gecko-robotics",
    focus: "Deploys inspection robots and sensors across energy, defense, and critical infrastructure.",
    channel: "bookface",
    kind: "hardware_company",
    people: [["Jake Loosararian", "Co-Founder and CEO", "critical"]],
  },
  {
    company: "Overview",
    website: "https://overview.ai/",
    sourceUrl: "https://www.ycombinator.com/companies/overview",
    focus: "Ships edge-AI cameras and inspection hardware to manufacturers around the world.",
    channel: "bookface",
    kind: "hardware_company",
    people: [["Christopher Van Dyke", "Co-Founder"]],
  },
  {
    company: "AutoPallet Robotics",
    website: "https://autopallet.bot/",
    sourceUrl: "https://www.ycombinator.com/companies/autopallet-robotics",
    focus: "Builds fleets of warehouse robots for case picking and palletization.",
    channel: "bookface",
    kind: "hardware_company",
    people: [["Eric Miller", "Co-Founder and CEO", "critical"]],
  },
  {
    company: "Bucket Robotics",
    website: "https://bucket.bot/",
    sourceUrl: "https://www.ycombinator.com/companies/bucket-robotics",
    focus: "Deploys machine-vision inspection systems into high-volume factories.",
    channel: "bookface",
    kind: "hardware_company",
    people: [["Matt Puchalski", "Founder and CEO"]],
  },
  {
    company: "Origami Robotics",
    website: "https://www.origamirobotics.com/",
    sourceUrl: "https://www.ycombinator.com/companies/origami-robotics",
    focus: "Manufactures dexterous robotic hands and data-collection hardware.",
    channel: "bookface",
    kind: "hardware_company",
    people: [["Ryan Xie", "Co-Founder"]],
  },
  {
    company: "RMFG",
    website: "https://www.rmfg.com/",
    sourceUrl: "https://www.ycombinator.com/companies/rmfg",
    focus: "Operates software-defined factories for precision parts and metal assemblies.",
    channel: "bookface",
    kind: "hardware_company",
    people: [["Kenneth Cassel", "Founder", "critical"]],
  },
  {
    company: "CircuitHub",
    website: "https://circuithub.com/",
    sourceUrl: "https://www.ycombinator.com/companies/circuithub",
    focus: "Runs on-demand electronics manufacturing and component sourcing for hardware teams.",
    channel: "bookface",
    kind: "hardware_company",
    people: [["Andrew Seddon", "Founder and CEO", "critical"]],
  },
  {
    company: "Mbodi AI",
    website: "https://www.mbodi.ai/",
    sourceUrl: "https://www.ycombinator.com/companies/mbodi-ai",
    focus: "Builds intelligent industrial robot systems with global hardware partners.",
    channel: "bookface",
    kind: "hardware_company",
    people: [["Xavier (Tianhao) Chi", "Founder"]],
  },
  {
    company: "Yondu",
    website: "https://yondu.ai/",
    sourceUrl: "https://www.ycombinator.com/companies/yondu",
    focus: "Deploys humanoid robots for warehouse and fulfillment operations.",
    channel: "bookface",
    kind: "hardware_company",
    people: [["Michael Chen", "Founder", "critical"]],
  },
  {
    company: "Servo7",
    website: "https://servo7.com/",
    sourceUrl: "https://www.ycombinator.com/companies/servo7",
    focus: "Builds robots that unload ocean containers inside warehouses.",
    channel: "bookface",
    kind: "hardware_company",
    people: [["Pieter Becking", "Co-Founder", "critical"]],
  },
  {
    company: "Cofactr",
    website: "https://www.cofactr.com/",
    sourceUrl: "https://www.ycombinator.com/companies/cofactr",
    focus: "Runs procurement and pre-factory logistics for electronics and aerospace teams.",
    channel: "bookface",
    kind: "hardware_company",
    people: [["Matthew Haber", "Co-Founder and CEO", "critical"]],
  },
  {
    company: "Ultra",
    website: "https://ultra.tech/",
    sourceUrl: "https://www.ycombinator.com/companies/ultra",
    focus: "Builds practical general-purpose robots for warehouses and industrial sites.",
    channel: "bookface",
    kind: "hardware_company",
    people: [["Jon Miller Schwartz", "Co-Founder"]],
  },
  {
    company: "Revise Robotics",
    website: "https://www.reviserobotics.com/",
    sourceUrl: "https://www.ycombinator.com/companies/revise-robotics",
    focus: "Builds robotic systems for testing and refurbishing consumer electronics.",
    channel: "bookface",
    kind: "hardware_company",
    people: [["Rupesh Jeyaram", "Founder", "critical"]],
  },
  {
    company: "BotBuilt",
    website: "https://botbuilt.com/",
    sourceUrl: "https://www.ycombinator.com/companies/botbuilt",
    focus: "Uses robotic production systems to manufacture building components.",
    channel: "bookface",
    kind: "hardware_company",
    people: [["Brent Wadas", "Founder"]],
  },
  {
    company: "Intelligence Factory",
    website: "https://intelligence-factory.com/",
    sourceUrl: "https://www.ycombinator.com/companies/intelligence-factory",
    focus: "Builds robotic intelligence with custom training gloves and physical data factories.",
    channel: "bookface",
    kind: "hardware_company",
    people: [["Yash Sinha", "Co-Founder and CEO"]],
  },
  {
    company: "InLoop Robotics",
    website: "https://inloop-robotics.com/",
    sourceUrl: "https://www.ycombinator.com/companies/inloop-robotics",
    focus: "Deploys robotic arms for warehouse picking and packing.",
    channel: "bookface",
    kind: "hardware_company",
    people: [["Zakariea Sharfeddine", "Founder"]],
  },
  {
    company: "Azalea Robotics",
    website: "https://azalearobotics.com/",
    sourceUrl: "https://www.ycombinator.com/companies/azalea-robotics-corporation",
    focus: "Builds robots that automate airport baggage handling.",
    channel: "bookface",
    kind: "hardware_company",
    people: [["David Millard", "Founder"]],
  },
  {
    company: "Nori",
    website: "https://norirobotics.com/",
    sourceUrl: "https://www.ycombinator.com/companies/noril1",
    focus: "Manufactures low-cost programmable humanoid robots.",
    channel: "bookface",
    kind: "hardware_company",
    people: [["Antonio Sitong Li", "Founder"]],
  },
  {
    company: "Manifold",
    website: "https://www.manifoldindustries.ai/",
    sourceUrl: "https://www.ycombinator.com/companies/manifold-2",
    focus: "Deploys low-cost robotic labor for warehouse picking, loading, and palletizing.",
    channel: "bookface",
    kind: "hardware_company",
    people: [["Joshua Ibrahim", "Founder"]],
  },
];

const LINKEDIN_HARDWARE_COMPANIES: readonly TargetGroup[] = [
  {
    company: "Apptronik",
    website: "https://apptronik.com/",
    sourceUrl: "https://apptronik.com/company/leadership",
    focus: "Manufactures Apollo humanoid robots for warehouses and industrial operations.",
    channel: "linkedin",
    kind: "hardware_company",
    people: [["Jeff Cardenas", "Co-Founder and CEO", "critical"]],
  },
  {
    company: "Agility Robotics",
    website: "https://www.agilityrobotics.com/",
    sourceUrl: "https://www.agilityrobotics.com/company",
    focus: "Manufactures Digit robots at commercial scale for logistics and manufacturing.",
    channel: "linkedin",
    kind: "hardware_company",
    people: [["Peggy Johnson", "CEO", "critical"]],
  },
  {
    company: "Skydio",
    website: "https://www.skydio.com/",
    sourceUrl: "https://www.skydio.com/about",
    focus: "Designs and manufactures autonomous drones in the United States.",
    channel: "linkedin",
    kind: "hardware_company",
    people: [["Adam Bry", "Co-Founder and CEO", "critical"]],
  },
  {
    company: "Anduril Industries",
    website: "https://www.anduril.com/",
    sourceUrl: "https://www.anduril.com/news/ai-insight-forum-national-security",
    focus: "Builds autonomous aircraft, sensors, underwater vehicles, and defense hardware.",
    channel: "linkedin",
    kind: "hardware_company",
    people: [["Brian Schimpf", "Co-Founder and CEO", "critical"]],
  },
  {
    company: "Formic",
    website: "https://formic.co/",
    sourceUrl: "https://formic.co/resources/articles/the-next-chapter",
    focus: "Deploys robot systems as a service into American factories.",
    channel: "linkedin",
    kind: "hardware_company",
    people: [["Saman Farid", "Co-Founder and CEO", "critical"]],
  },
  {
    company: "Dexterity",
    website: "https://dexterity.ai/",
    sourceUrl: "https://dexterity.ai/about",
    focus: "Builds intelligent robotic systems for truck loading and logistics.",
    channel: "linkedin",
    kind: "hardware_company",
    people: [["Samir Menon", "Founder and CEO", "critical"]],
  },
  {
    company: "Chef Robotics",
    website: "https://www.chefrobotics.ai/",
    sourceUrl: "https://www.chefrobotics.ai/company/",
    focus: "Manufactures and deploys food-production robots.",
    channel: "linkedin",
    kind: "hardware_company",
    people: [["Rajat Bhageria", "Founder and CEO"]],
  },
  {
    company: "Bright Machines",
    website: "https://www.brightmachines.com/",
    sourceUrl: "https://www.brightmachines.com/about/",
    focus: "Builds software-defined manufacturing systems and microfactories.",
    channel: "linkedin",
    kind: "hardware_company",
    people: [["Sviat Dulianinov", "CEO"]],
  },
  {
    company: "Standard Bots",
    website: "https://standardbots.com/",
    sourceUrl: "https://standardbots.com/about",
    focus: "Designs and manufactures AI-native industrial robot arms.",
    channel: "linkedin",
    kind: "hardware_company",
    people: [["Evan Beard", "Co-Founder and CEO", "critical"]],
  },
  {
    company: "Fictiv",
    website: "https://www.fictiv.com/",
    sourceUrl: "https://www.fictiv.com/about-us",
    focus: "Operates global manufacturing centers and cross-border supply chains.",
    channel: "linkedin",
    kind: "hardware_company",
    people: [["Dave Evans", "Co-Founder and CEO", "critical"]],
  },
  {
    company: "Xometry",
    website: "https://www.xometry.com/",
    sourceUrl: "https://investors.xometry.com/board-member/randy-altschuler",
    focus: "Connects hardware buyers with a global custom-manufacturing network.",
    channel: "linkedin",
    kind: "hardware_company",
    people: [["Randy Altschuler", "Co-Founder and Executive Chair", "critical"]],
  },
  {
    company: "Machina Labs",
    website: "https://machinalabs.ai/",
    sourceUrl: "https://machinalabs.ai/machina-labs-media-kit",
    focus: "Builds robotic, software-defined factories for metal parts.",
    channel: "linkedin",
    kind: "hardware_company",
    people: [["Edward Mehr", "Founder and CEO", "critical"]],
  },
  {
    company: "Form Energy",
    website: "https://formenergy.com/",
    sourceUrl: "https://formenergy.com/team/mateo-jaramillo/",
    focus: "Manufactures iron-air batteries at utility scale.",
    channel: "linkedin",
    kind: "hardware_company",
    people: [["Mateo Jaramillo", "Co-Founder and CEO", "critical"]],
  },
  {
    company: "Redwood Materials",
    website: "https://www.redwoodmaterials.com/",
    sourceUrl: "https://www.redwoodmaterials.com/about/",
    focus: "Manufactures battery materials and energy-storage systems across large U.S. campuses.",
    channel: "linkedin",
    kind: "hardware_company",
    people: [["JB Straubel", "Founder and CEO", "critical"]],
  },
  {
    company: "Sila",
    website: "https://www.silanano.com/",
    sourceUrl: "https://www.silanano.com/about-us",
    focus: "Manufactures next-generation silicon anode materials for batteries.",
    channel: "linkedin",
    kind: "hardware_company",
    people: [["Gene Berdichevsky", "Co-Founder and CEO", "critical"]],
  },
  {
    company: "Twelve",
    website: "https://www.twelve.co/",
    sourceUrl: "https://www.twelve.co/post/conferences-events-calendar",
    focus: "Builds industrial systems that turn carbon dioxide into fuels and materials.",
    channel: "linkedin",
    kind: "hardware_company",
    people: [["Nicholas Flanders", "Co-Founder and CEO"]],
  },
  {
    company: "Electric Hydrogen",
    website: "https://eh2.com/",
    sourceUrl: "https://eh2.com/company/",
    focus: "Manufactures large electrolyzer systems at gigafactory scale.",
    channel: "linkedin",
    kind: "hardware_company",
    people: [["Raffi Garabedian", "Co-Founder and CEO", "critical"]],
  },
  {
    company: "Antora Energy",
    website: "https://www.antora.com/",
    sourceUrl: "https://www.antora.com/company",
    focus: "Manufactures thermal batteries for industrial heat and power.",
    channel: "linkedin",
    kind: "hardware_company",
    people: [["Andrew Ponec", "Co-Founder and CEO", "critical"]],
  },
  {
    company: "Rondo Energy",
    website: "https://www.rondo.com/",
    sourceUrl: "https://www.rondo.com/leadership",
    focus: "Builds and deploys industrial heat batteries across multiple continents.",
    channel: "linkedin",
    kind: "hardware_company",
    people: [["Eric Trusiewicz", "CEO", "critical"]],
  },
  {
    company: "Heirloom",
    website: "https://www.heirloomcarbon.com/",
    sourceUrl: "https://www.heirloomcarbon.com/news/announcing-heirloom",
    focus: "Builds automated direct-air-capture facilities and materials-handling systems.",
    channel: "linkedin",
    kind: "hardware_company",
    people: [["Shashank Samala", "Co-Founder and CEO", "critical"]],
  },
  {
    company: "Charm Industrial",
    website: "https://charmindustrial.com/",
    sourceUrl: "https://charmindustrial.com/team",
    focus: "Builds pyrolysis and carbon-removal equipment for distributed field operations.",
    channel: "linkedin",
    kind: "hardware_company",
    people: [["Peter Reinhardt", "Co-Founder and CEO"]],
  },
  {
    company: "K2 Space",
    website: "https://www.k2space.com/",
    sourceUrl: "https://www.k2space.com/about",
    focus: "Designs and manufactures large satellite platforms and orbital infrastructure.",
    channel: "linkedin",
    kind: "hardware_company",
    people: [["Karan Kunjur", "Co-Founder and CEO", "critical"]],
  },
  {
    company: "Impulse Space",
    website: "https://www.impulsespace.com/",
    sourceUrl: "https://www.impulsespace.com/about",
    focus: "Manufactures spacecraft and propulsion systems for in-space mobility.",
    channel: "linkedin",
    kind: "hardware_company",
    people: [["Tom Mueller", "Founder and CEO", "critical"]],
  },
  {
    company: "Waabi",
    website: "https://waabi.ai/",
    sourceUrl: "https://waabi.ai/company",
    focus: "Builds autonomous-trucking systems and physical AI hardware.",
    channel: "linkedin",
    kind: "hardware_company",
    people: [["Raquel Urtasun", "Founder and CEO", "critical"]],
  },
  {
    company: "Outrider",
    website: "https://www.outrider.ai/",
    sourceUrl: "https://www.outrider.ai/blog/company-news/autonomous-zero-emission-distribution-yards-welcome-outrider/",
    focus: "Builds autonomous electric yard trucks for logistics hubs.",
    channel: "linkedin",
    kind: "hardware_company",
    people: [["Andrew Smith", "Founder and CEO", "critical"]],
  },
  {
    company: "Nuro",
    website: "https://www.nuro.ai/",
    sourceUrl: "https://www.nuro.ai/company",
    focus: "Builds autonomous driving hardware and vehicle platforms.",
    channel: "linkedin",
    kind: "hardware_company",
    people: [["Jiajun Zhu", "Co-Founder and Co-CEO", "critical"]],
  },
  {
    company: "Collaborative Robotics",
    website: "https://www.co.bot/",
    sourceUrl: "https://www.co.bot/team",
    focus: "Builds collaborative robots for commercial and industrial work.",
    channel: "linkedin",
    kind: "hardware_company",
    people: [["Brad Porter", "Co-Founder and CEO", "critical"]],
  },
  {
    company: "Monumental",
    website: "https://www.monumental.co/",
    sourceUrl: "https://www.monumental.co/press/series-b-us",
    focus: "Operates a fleet of construction robots and is launching in the United States.",
    channel: "linkedin",
    kind: "hardware_company",
    people: [["Salar al Khafaji", "Co-Founder and CEO"]],
  },
  {
    company: "Efference",
    website: "https://efference.ai/",
    sourceUrl: "https://www.ycombinator.com/companies/efference",
    focus: "Manufactures stereo-vision cameras for robots, drones, and autonomous vehicles.",
    channel: "linkedin",
    kind: "hardware_company",
    people: [["Gianluca Bencomo", "Founder"]],
  },
  {
    company: "Inversion Semiconductor",
    website: "https://www.inversionsemi.com/",
    sourceUrl: "https://www.ycombinator.com/companies/inversion-semiconductor",
    focus: "Builds next-generation semiconductor lithography machines.",
    channel: "linkedin",
    kind: "hardware_company",
    people: [["Rohan Karthik", "Co-Founder and CEO", "critical"]],
  },
];

const EMAIL_HARDWARE_VCS: readonly TargetGroup[] = [
  {
    company: "Fifty Years",
    website: "https://fiftyyears.com/",
    sourceUrl: "https://fiftyyears.com/team-1",
    focus: "Deep-tech founders in industrial systems, robotics, climate, space, and physical infrastructure.",
    channel: "email",
    kind: "hardware_vc",
    people: [
      ["Seth Bannon", "Founding Partner", "critical"],
      ["Ela Madej", "Founding Partner", "critical"],
    ],
  },
  {
    company: "DCVC",
    website: "https://www.dcvc.com/",
    sourceUrl: "https://www.dcvc.com/team/",
    focus: "Deep-tech companies commercializing hardware, industrial systems, robotics, and infrastructure.",
    channel: "email",
    kind: "hardware_vc",
    people: [
      ["Matt Ocko", "Co-Founder and Managing Partner", "critical"],
      ["Zachary Bogue", "Co-Founder and Managing Partner", "critical"],
      ["James Hardiman", "General Partner"],
      ["Rachel Slaybaugh", "General Partner", "critical"],
      ["Milo Werner", "General Partner"],
      ["Ali Tamaseb", "General Partner"],
    ],
  },
  {
    company: "Lux Capital",
    website: "https://www.luxcapital.com/",
    sourceUrl: "https://www.luxcapital.com/people",
    focus: "Frontier science and engineering companies with complex hardware and supply chains.",
    channel: "email",
    kind: "hardware_vc",
    people: [
      ["Peter Hebert", "Partner and Co-Founder", "critical"],
      ["Josh Wolfe", "Partner and Co-Founder", "critical"],
      ["Shahin Farshchi", "Partner", "critical"],
      ["Brandon Reeves", "Partner"],
      ["Deena Shakir", "Partner"],
      ["Grace Isford", "Partner"],
    ],
  },
  {
    company: "Root Ventures",
    website: "https://root.vc/",
    sourceUrl: "https://root.vc/welcome.htm",
    focus: "Seed-stage hard-tech founders building robotics, manufacturing, and physical systems.",
    channel: "email",
    kind: "hardware_vc",
    people: [
      ["Avidan Ross", "Managing Partner", "critical"],
      ["Kane Hsieh", "Partner", "critical"],
      ["Chrissy Meyer", "Partner"],
    ],
  },
  {
    company: "Playground Global",
    website: "https://www.playground.vc/",
    sourceUrl: "https://www.playground.vc/people",
    focus: "Deep-tech and industrial portfolio companies moving physical products and equipment.",
    channel: "email",
    kind: "hardware_vc",
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
  },
  {
    company: "SOSV / HAX",
    website: "https://sosv.com/hax/",
    sourceUrl: "https://sosv.com/team/",
    focus: "Hardware founders with manufacturing, China, cross-border, and freight needs.",
    channel: "email",
    kind: "hardware_vc",
    people: [
      ["Cyril Ebersweiler", "General Partner and HAX Managing Director", "critical"],
      ["Duncan Turner", "General Partner and HAX Managing Director", "critical"],
      ["Avra van der Zee", "General Partner"],
      ["Susan Schofer", "Partner and Chief Science Officer"],
      ["Ji Ke", "Partner and HAX CTO", "critical"],
      ["Andrew Gollach", "Partner"],
      ["Sean O'Sullivan", "Managing General Partner", "critical"],
    ],
  },
  {
    company: "Construct Capital",
    website: "https://www.constructcap.com/",
    sourceUrl: "https://www.constructcap.com/",
    focus: "Founders transforming manufacturing, supply chain, logistics, and industrial operations.",
    channel: "email",
    kind: "hardware_vc",
    people: [
      ["Dayna Grayson", "Co-Founder and Managing Partner", "critical"],
      ["Rachel Holt", "Co-Founder and Managing Partner", "critical"],
    ],
  },
  {
    company: "Prime Movers Lab",
    website: "https://www.primemoverslab.com/",
    sourceUrl: "https://www.primemoverslab.com/team/",
    focus: "Breakthrough science and industrial companies that ship specialized hardware and equipment.",
    channel: "email",
    kind: "hardware_vc",
    people: [
      ["Dakin Sloss", "Founder and General Partner", "critical"],
      ["Zia Huque", "General Partner", "critical"],
      ["Gavin Mathis", "Partner and Chief of Staff"],
      ["Roger Carter", "VP of Engineering"],
      ["JJ Moi", "Design Partner"],
      ["Amy Kruse", "Venture Partner"],
    ],
  },
  {
    company: "Energy Impact Partners",
    website: "https://www.energyimpactpartners.com/",
    sourceUrl: "https://www.energyimpactpartners.com/team/",
    focus: "Climate, electrification, energy, mobility, and industrial portfolio companies with physical supply chains.",
    channel: "email",
    kind: "hardware_vc",
    people: [
      ["Hans Kobler", "Founder and Managing Partner", "critical"],
      ["Lindsay Luger", "Co-Founder and Partner", "critical"],
      ["Sameer Reddy", "Managing Partner, Flagship", "critical"],
      ["Cassie Bowe", "Partner"],
      ["Shayle Kann", "Managing Partner, Frontier"],
    ],
  },
  {
    company: "Schematic Ventures",
    website: "https://www.schematicventures.com/",
    sourceUrl: "https://www.schematicventures.com/",
    focus: "Supply-chain, logistics, manufacturing, and commerce infrastructure founders.",
    channel: "email",
    kind: "hardware_vc",
    people: [["Julian Counihan", "General Partner", "critical"]],
  },
  {
    company: "Ironspring Ventures",
    website: "https://ironspring.com/",
    sourceUrl: "https://ironspring.com/team/",
    focus: "Industrial supply chain, construction, manufacturing, and logistics technology founders.",
    channel: "email",
    kind: "hardware_vc",
    people: [
      ["Ty Findley", "Co-Founder and General Partner", "critical"],
      ["Peter J. Holt", "Co-Founder and General Partner", "critical"],
      ["Natan Reddy", "Principal"],
      ["Drew Kriens", "Principal"],
      ["Charlie Kirn", "Investor"],
    ],
  },
  {
    company: "Dynamo Ventures",
    website: "https://dynamo.vc/",
    sourceUrl: "https://dynamo.vc/about",
    focus: "Supply-chain and mobility founders who can introduce hardware exporters and importers.",
    channel: "email",
    kind: "hardware_vc",
    people: [
      ["Santosh Sankar", "Co-Founder and Managing Partner", "critical"],
      ["Jon Bradford", "Co-Founder and Managing Partner", "critical"],
      ["Ted Alling", "Co-Founder and Partner"],
      ["Barry Large", "Co-Founder and Partner"],
    ],
  },
  {
    company: "Autotech Ventures",
    website: "https://www.autotechvc.com/",
    sourceUrl: "https://www.autotechvc.com/team",
    focus: "Mobility, transportation, automotive, logistics, and industrial hardware companies.",
    channel: "email",
    kind: "hardware_vc",
    people: [
      ["Quin Garcia", "Investment Team", "critical"],
      ["Alexei Andreev", "Investment Team", "critical"],
      ["Maurice Gunderson", "Investment Team"],
      ["Burak Cendek", "Investment Team"],
    ],
  },
  {
    company: "Material Impact",
    website: "https://www.materialimpact.com/",
    sourceUrl: "https://www.materialimpact.com/team/",
    focus: "Materials, manufacturing, climate, and deep-tech companies with specialized logistics requirements.",
    channel: "email",
    kind: "hardware_vc",
    people: [
      ["Carmichael Roberts", "Co-Founder and Managing Partner", "critical"],
      ["Adam Sharkawy", "Co-Founder and Managing Partner", "critical"],
      ["Corinna Chen", "Partner"],
    ],
  },
];

export const HARDWARE_VC_OUTREACH_CAMPAIGN: readonly HardwareVcOutreachTarget[] = [
  ...BOOKFACE_HARDWARE_COMPANIES.flatMap(groupTargets),
  ...LINKEDIN_HARDWARE_COMPANIES.flatMap(groupTargets),
  ...EMAIL_HARDWARE_VCS.flatMap(groupTargets),
];

export const HARDWARE_VC_CAMPAIGN_TAG = "hardware_outreach_channel_split_2026_07_27_v2";
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
  if (target.kind === "hardware_company") {
    const route =
      target.channel === "bookface"
        ? `Search Bookface for ${target.name} at ${target.company}.`
        : "Use the LinkedIn search link and verify the exact profile before sending.";
    return [
      "Hardware company freight prospect.",
      `Why: ${target.focus}`,
      "Ask: learn how they currently handle international components, Asia manufacturing, and U.S. inbound freight, then offer a focused lane or shipment review.",
      route,
      `Official source: ${target.sourceUrl}`,
      `Reviewed: ${HARDWARE_VC_CAMPAIGN_REVIEWED_AT}.`,
      `Campaign: ${HARDWARE_VC_CAMPAIGN_TAG}.`,
    ].join(" ");
  }

  return [
    "Hardware VC portfolio-intro target.",
    `Why: ${target.focus}`,
    "Ask: request 2-3 introductions to portfolio founders importing hardware, manufacturing in Asia, or needing U.S. freight support.",
    "Email needed. Use the LinkedIn search and official team page to verify the address.",
    `Official source: ${target.sourceUrl}`,
    `Reviewed: ${HARDWARE_VC_CAMPAIGN_REVIEWED_AT}.`,
    `Campaign: ${HARDWARE_VC_CAMPAIGN_TAG}.`,
  ].join(" ");
}
