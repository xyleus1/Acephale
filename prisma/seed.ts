import { PrismaClient, UserRole } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient();

// ── Realistic freight-forwarding company names ──────────────────
const companies = [
  "Akdeniz Denizcilik A.Ş.", "Boğaziçi Lojistik Ltd.", "Marmara Taşımacılık",
  "Ege Shipping Co.", "Anadolu Freight Services", "Silk Road Cargo",
  "Istanbul Gateway Logistics", "Bosphorus Forwarding", "Türk Express Lines",
  "Karadeniz Transport", "Orient Star Shipping", "Levant Cargo Partners",
  "Eurasia Supply Chain", "Transmed Logistics", "Anatolia Bulk Carriers",
  "Toros Lojistik A.Ş.", "Çelik Nakliyat Ltd.", "Yıldız Cargo Systems",
  "Aksu Freight Group", "Demiryolu Lojistik", "Petrol Taşımacılık A.Ş.",
  "Mega Logistics Istanbul", "Summit Freight Turkey", "Continental Cargo TR",
  "Marmaris Shipping Co.", "Delta Transport Solutions", "Prime Forwarders Ltd.",
  "Black Sea Lines", "Adriatik Lojistik", "Atlas Forwarding Group",
  "Poseidon Shipping TR", "Anatolian Trade Co.", "Caspian Cargo Ltd.",
  "Nordic Bridge Logistics", "Sunrise Freight Istanbul", "Harbour Gate Shipping",
  "Konya Lojistik A.Ş.", "Izmir Port Services", "Adana Cargo Networks",
  "Bursa Supply Solutions", "Tekirdağ Shipping Ltd.", "Eskişehir Freight Co.",
  "Gaziantep Trade Lines", "Mersin Port Logistics", "Trabzon Cargo A.Ş.",
  "Balkan Freight Partners", "Silver Route Logistics", "Danube Bridge Cargo",
  "Aegean Star Shipping", "Pacific Rim Turkey", "Horizon Cargo Istanbul",
  "Blue Anchor Logistics", "Crossroads Freight TR", "Nexus Supply Chain",
  "Titan Forwarding A.Ş.", "Crescent Cargo Co.", "Golden Horn Logistics",
  "Polaris Shipping Group", "Vega Transport Ltd.", "Orion Freight Solutions",
  "Mediterranean Gate Co.", "Eastern Bridge Logistics", "Phoenix Cargo TR",
  "Swift Freight Istanbul", "Pinnacle Logistics TR", "Cornerstone Cargo Co.",
  "Frontier Forwarding Ltd.", "Capital Freight Solutions", "Meridian Transport A.Ş.",
  "Apex Logistics Group", "Nova Cargo Networks", "Summit Supply Chain",
  "Trident Shipping TR", "Cascade Logistics Ltd.", "Helix Forwarding Co.",
  "Vertex Cargo Systems", "Citadel Freight A.Ş.", "Milestone Transport TR",
  "Anchor Point Logistics", "Ironclad Cargo Co.", "Greenline Forwarding",
  "Clearway Logistics Istanbul", "Fastlane Freight TR", "Starlux Cargo Ltd.",
  "Interlink Forwarding", "Uniflex Logistics A.Ş.", "Jetstream Cargo TR",
  "Omnicargo Istanbul", "Prolink Freight Co.", "Sealink Transport Ltd.",
  "Eurogate Turkey", "Skybridge Cargo A.Ş.", "Landbridge Logistics",
  "Transworld Forwarding TR", "Overland Cargo Co.", "Deepwater Shipping",
  "Upland Logistics Ltd.", "Fasttrack Forwarding", "Crosslink Cargo TR",
  "Alliance Freight A.Ş.", "Union Transport Istanbul", "Fortis Cargo Co.",
  "Magellan Logistics TR", "Columbus Forwarding", "Drake Cargo Solutions",
  "Endeavour Shipping Ltd.", "Resolute Freight A.Ş.", "Valiant Transport Co.",
  "Stalwart Logistics TR", "Durable Cargo Ltd.", "Steadfast Forwarding",
  "Reliable Freight Istanbul", "Trusted Cargo Systems", "Proven Transport A.Ş.",
  "Benchmark Logistics Co.", "Standard Cargo TR", "Reference Forwarding Ltd.",
  "Keystone Shipping A.Ş.", "Foundation Cargo Co.", "Bedrock Logistics TR",
  "Cornerstone Transport", "Capstone Freight Ltd.", "Milestone Cargo A.Ş."
];

const firstNames = [
  "Ahmet", "Mehmet", "Mustafa", "Ali", "Hasan", "Hüseyin", "İbrahim", "Ömer",
  "Fatma", "Ayşe", "Emine", "Hatice", "Zeynep", "Elif", "Merve", "Selin",
  "Kemal", "Selim", "Tarık", "Burak", "Cem", "Deniz", "Emre", "Furkan",
  "Gül", "İpek", "Nilüfer", "Özlem", "Pınar", "Reyhan", "Sibel", "Tuba"
];

const lastNames = [
  "Yılmaz", "Kaya", "Demir", "Şahin", "Çelik", "Aydın", "Arslan", "Doğan",
  "Kılıç", "Aslan", "Çetin", "Yıldız", "Erdoğan", "Öztürk", "Acar", "Bulut",
  "Koç", "Kurt", "Özkan", "Şimşek", "Polat", "Aktaş", "Taş", "Güngör",
  "Karahan", "Bozkurt", "Duman", "Kaplan", "Çakır", "Güler", "Aksoy", "Tekin"
];

const titles = [
  "Lojistik Müdürü", "Operations Manager", "Procurement Director",
  "Import/Export Manager", "Freight Coordinator", "Logistics Supervisor",
  "Supply Chain Manager", "Trade Finance Director", "Customs Coordinator",
  "Business Development Manager", "Account Manager", "Finance Director",
  "CEO", "COO", "General Manager", "Regional Director"
];

const activitySubjects = {
  VISIT: [
    "Q2 rate review meeting", "Annual account planning session", "On-site operations audit",
    "Lane pricing discussion", "New route proposal presentation", "Contract renewal meeting",
    "Customer satisfaction review", "Service expansion discussion", "Port visit and briefing",
    "Quarterly business review"
  ],
  CALL: [
    "Shipment status update", "Rate quote follow-up", "Customs delay discussion",
    "Transit time inquiry", "Booking confirmation", "Invoice clarification call",
    "New business opportunity call", "Complaint resolution call", "Capacity planning call",
    "Documentation requirements review"
  ],
  EMAIL: [
    "Rate sheet update", "New tariff schedule", "Port congestion advisory",
    "Revised quote submission", "Contract amendment draft", "SOA monthly statement",
    "Shipment tracking report", "Service disruption notice", "Holiday schedule notice",
    "Credit limit review"
  ],
  WHATSAPP: [
    "Quick ETA update", "Urgent booking request", "Document submission reminder",
    "Payment confirmation", "Container release update"
  ]
};

const activityBodies = [
  "Customer confirmed interest in expanding volume on this lane. Follow-up scheduled for next quarter.",
  "Discussed competitive pricing pressure from alternative forwarders. Proposed consolidated rate.",
  "Reviewed last 6 months shipment data. Customer satisfied with transit times but flagged documentation delays.",
  "Agreed on Q3 rate lock for Sea FCL movements. Volume commitment of 40 TEU/month.",
  "Customer raising concerns about rising surcharges. Need to present revised cost breakdown.",
  "Strong meeting — customer ready to sign LOI for Air freight segment. Involve pricing team.",
  "Touched base on pending invoice. Payment processing delay on their end, expected next week.",
  "Presented new Ro-Ro solution for Turkey-Germany corridor. Customer requested detailed proposal.",
  "Discussed customs compliance requirements for new product category. Will loop in compliance team.",
  "Customer confirmed they are evaluating 3 providers. We're shortlisted. Differentiator: transit speed.",
  "Shipment documentation reviewed — all clear. Cargo estimated to arrive within 72 hours.",
  "Addressed service failure from last month. Customer accepted our recovery plan and credit note.",
  "Positive conversation about opening a new import lane from China. Volume TBD pending sourcing plans.",
  "Customer shared upcoming tender for annual contract. Worth ~$2M. Deadline for submission: 30 days.",
  "Reviewed peak season capacity plan. Customer needs guaranteed slots for Oct-Dec period."
];

const taskTitles = [
  "Send revised rate proposal", "Prepare Q3 capacity plan", "Follow up on pending invoice",
  "Schedule operations review call", "Submit customs documentation", "Prepare contract renewal draft",
  "Coordinate with port agent on delays", "Send transit time comparison sheet",
  "Collect missing shipping documents", "Prepare credit note for service failure",
  "Present new lane pricing to customer", "Confirm booking for next shipment",
  "Escalate rate dispute to management", "Send annual account summary report",
  "Check surcharge applicability and advise"
];

const riskReasons = [
  "No contact logged in 21+ days — account going cold",
  "3 consecutive lost quotes — pricing misalignment likely",
  "Previous meeting flagged as unresponsive — follow-up overdue",
  "Volume dropped 60% vs same period last year",
  "Customer mentioned competitor evaluation in last activity",
  "Invoice dispute unresolved for 30+ days",
  "Key contact changed — relationship reset needed",
  "No activity logged after onboarding — engagement not established",
  "Last quote rejected without counter — sentiment unknown"
];

function pick<T>(arr: T[], i: number): T {
  return arr[Math.abs(i) % arr.length];
}

function dateDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function moneyFor(i: number) {
  const bases = [4500, 8200, 12500, 6800, 22000, 35000, 15000, 9500, 48000, 3200];
  return bases[i % bases.length] + (i % 7) * 1250;
}

async function main() {
  await prisma.savedView.deleteMany();
  await prisma.riskAlert.deleteMany();
  await prisma.task.deleteMany();
  await prisma.event.deleteMany();
  await prisma.assignmentChange.deleteMany();
  await prisma.quote.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.companyOwner.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.company.deleteMany();
  await prisma.categoryOption.deleteMany();
  await prisma.user.deleteMany();
  await prisma.office.deleteMany();

  const office = await prisma.office.create({ data: { name: "Istanbul Office" } });

  const adminHash = await hashPassword("admin1234");
  const managerHash = await hashPassword("manager1234");

  const admin = await prisma.user.create({
    data: {
      officeId: office.id,
      email: "admin@demo.local",
      fullName: "Derya Kaya",
      role: UserRole.ADMIN,
      canViewWholeOffice: true,
      passwordHash: adminHash
    }
  });

  const manager = await prisma.user.create({
    data: {
      officeId: office.id,
      email: "manager@demo.local",
      fullName: "Tarık Yılmaz",
      role: UserRole.MANAGER,
      canViewWholeOffice: true,
      passwordHash: managerHash
    }
  });

  const salesReps = [
    { name: "Ahmet Çelik", email: "sales1@demo.local", pass: "sales11234" },
    { name: "Selin Arslan", email: "sales2@demo.local", pass: "sales21234" },
    { name: "Burak Demir", email: "sales3@demo.local", pass: "sales31234" },
    { name: "Merve Şahin", email: "sales4@demo.local", pass: "sales41234" },
    { name: "Emre Kılıç", email: "sales5@demo.local", pass: "sales51234" },
    { name: "Özlem Aydın", email: "sales6@demo.local", pass: "sales61234" },
    { name: "Furkan Aslan", email: "sales7@demo.local", pass: "sales71234" },
    { name: "İpek Doğan", email: "sales8@demo.local", pass: "sales81234" }
  ];

  const salesUsers = [];
  for (const [i, rep] of salesReps.entries()) {
    const user = await prisma.user.create({
      data: {
        officeId: office.id,
        email: rep.email,
        fullName: rep.name,
        role: UserRole.SALES,
        canViewWholeOffice: i < 2,
        passwordHash: await hashPassword(rep.pass)
      }
    });
    salesUsers.push(user);
  }

  const allUsers = [admin, manager, ...salesUsers];

  // ── Category options ──────────────────────────────────────────
  const categorySeeds = [
    ...(["Passive", "Potential", "Active"] as const).map((v) => ({ officeId: office.id, type: "CLASS1" as const, value: v })),
    ...(["A", "B", "C", "D", "E"] as const).map((v) => ({ officeId: office.id, type: "CLASS2" as const, value: v })),
    ...(["Sea FCL", "Sea LCL", "Air Freight", "Road FTL", "Road LTL", "Project Cargo"] as const).map((v) => ({ officeId: office.id, type: "PRODUCT" as const, value: v })),
    ...(["US Import", "US Export", "Germany Import", "Germany Export", "UK Import", "UK Export", "China Import", "Far East Import", "Middle East Export", "Belgium Export", "Mediterranean", "Black Sea"] as const).map((v) => ({ officeId: office.id, type: "LANE" as const, value: v }))
  ];

  for (const item of categorySeeds) {
    await prisma.categoryOption.create({ data: item });
  }

  const statuses = ["UNTOUCHED", "IN_PROGRESS", "WORKED", "LOST"] as const;
  const class1Values = ["Passive", "Potential", "Active"];
  const class2Values = ["A", "B", "C", "D", "E"];
  const products = ["Sea FCL", "Sea LCL", "Air Freight", "Road FTL", "Road LTL", "Project Cargo"];
  const lanes = ["US Import", "Germany Import", "UK Export", "China Import", "Far East Import", "Middle East Export", "Belgium Export", "Mediterranean", "Black Sea", "Germany Export"];
  const activityTypes = ["VISIT", "CALL", "EMAIL", "CALL", "EMAIL"] as const; // weighted toward call/email

  const companyList = companies.slice(0, 120);

  for (let i = 0; i < companyList.length; i++) {
    const name = companyList[i];
    const status = statuses[i % statuses.length];
    const class1 = pick(class1Values, i);
    const class2 = pick(class2Values, i * 3);
    const product = pick(products, i * 7);
    const lane = pick(lanes, i * 11);

    const company = await prisma.company.create({
      data: { officeId: office.id, name, status, class1, class2, product, lane }
    });

    // 1–3 contacts
    const contactCount = 1 + (i % 3);
    for (let c = 0; c < contactCount; c++) {
      const fn = pick(firstNames, i + c * 7);
      const ln = pick(lastNames, i + c * 13);
      await prisma.contact.create({
        data: {
          companyId: company.id,
          fullName: `${fn} ${ln}`,
          title: pick(titles, c + i),
          email: `${fn.toLowerCase()}.${ln.toLowerCase()}@${name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12)}.com`,
          phone: `+90 5${String(30 + (i % 70)).padStart(2, "0")} ${String(100 + i * 3 + c).padStart(3, "0")} ${String(10 + c * 17 + i).padStart(2, "0")} ${String(i % 100).padStart(2, "0")}`
        }
      });
    }

    // Assign to 1 primary sales rep (clean ownership)
    const primaryRep = salesUsers[i % salesUsers.length];
    await prisma.companyOwner.create({
      data: { companyId: company.id, userId: primaryRep.id, isPrimary: true }
    });
    // Occasionally a second rep co-owns
    if (i % 4 === 0 && salesUsers.length > 1) {
      const secondRep = salesUsers[(i + 1) % salesUsers.length];
      await prisma.companyOwner.create({
        data: { companyId: company.id, userId: secondRep.id, isPrimary: false }
      });
    }

    // 2–7 activities — stale for some companies to trigger risk
    const isStale = i % 6 === 0;
    const activityCount = 2 + (i % 6);
    for (let a = 0; a < activityCount; a++) {
      const dayOffset = isStale ? 20 + a * 3 : Math.max(1, (a + 1) * (i % 3 === 0 ? 4 : 2));
      const type = activityTypes[(a + i) % activityTypes.length];
      const subjects = activitySubjects[type] ?? activitySubjects.CALL;
      await prisma.activity.create({
        data: {
          officeId: office.id,
          companyId: company.id,
          type,
          occurredAt: dateDaysAgo(dayOffset),
          subject: pick(subjects, a + i),
          body: pick(activityBodies, a + i * 3),
          createdByUserId: salesUsers[(i + a) % salesUsers.length].id
        }
      });
    }

    // 0–3 quotes — mix of WON, LOST, and PENDING
    const quoteCount = i % 4;
    for (let q = 0; q < quoteCount; q++) {
      const mod = (i + q) % 5;
      const result = mod <= 1 ? "PENDING" : mod === 2 ? "LOST" : "WON";
      const currencies = ["USD", "EUR", "TRY"];
      const origins = ["Istanbul", "Izmir", "Mersin", "Ankara", "Bursa"];
      const destinations = ["Hamburg", "Rotterdam", "New York", "Shanghai", "Dubai", "London", "Los Angeles"];
      const modes = ["SEA-FCL", "SEA-LCL", "AIR", "ROAD"];
      await prisma.quote.create({
        data: {
          officeId: office.id,
          companyId: company.id,
          result,
          origin: pick(origins, i + q),
          destination: pick(destinations, i + q * 3),
          mode: pick(modes, i + q * 2),
          value: moneyFor(i + q),
          currency: pick(currencies, q + i),
          notes: result === "WON"
            ? "Competitive offer accepted — rate lock confirmed."
            : result === "LOST"
            ? "Lost to lower-cost competitor. Customer cited pricing as primary factor."
            : "Quote submitted — awaiting customer decision.",
          quotedAt: dateDaysAgo((q + 1) * 4 + (i % 3))
        }
      });
    }

    // 0–2 tasks per company — spread dates: some overdue, some upcoming
    const taskCount = i % 3;
    const dueDateOffsets = [-7, -3, -1, 2, 5, 8, 14]; // negative = overdue, positive = future
    const taskStatuses = ["OPEN", "OPEN", "OPEN", "DONE", "CANCELLED"] as const;
    for (let t = 0; t < taskCount; t++) {
      const dueOffset = dueDateOffsets[(i * 3 + t) % dueDateOffsets.length];
      await prisma.task.create({
        data: {
          officeId: office.id,
          companyId: company.id,
          title: pick(taskTitles, t + i * 5),
          details: "Follow-up required as part of account management workflow.",
          dueAt: dateDaysAgo(-dueOffset), // dateDaysAgo(-(-7)) = dateDaysAgo(7) = 7 days ago = overdue
          status: taskStatuses[(i + t) % taskStatuses.length],
          assignedToUserId: salesUsers[(i + t) % salesUsers.length].id,
          createdByUserId: salesUsers[i % salesUsers.length].id
        }
      });
    }

    // Risk alerts
    if (isStale) {
      await prisma.riskAlert.create({
        data: {
          officeId: office.id,
          companyId: company.id,
          level: (i % 12 === 0) ? "HIGH" : "MEDIUM",
          reason: pick(riskReasons, i),
          isOpen: true
        }
      });
    }
    if (i % 10 === 0 && i > 0) {
      await prisma.riskAlert.create({
        data: {
          officeId: office.id,
          companyId: company.id,
          level: "HIGH",
          reason: "Repeated quote losses in recent cycle — pricing review required",
          isOpen: false,
          resolvedAt: dateDaysAgo(3)
        }
      });
    }
  }

  // ── Saved views ───────────────────────────────────────────────
  await prisma.savedView.createMany({
    data: [
      {
        officeId: office.id,
        userId: admin.id,
        name: "Active Sea FCL Accounts",
        filters: { status: "IN_PROGRESS", class1: "Active", product: "Sea FCL", sortBy: "updatedAt", sortDir: "desc", q: "", class2: "", lane: "" }
      },
      {
        officeId: office.id,
        userId: admin.id,
        name: "Untouched Potential",
        filters: { status: "UNTOUCHED", class1: "Potential", sortBy: "createdAt", sortDir: "asc", q: "", class2: "", product: "", lane: "" }
      },
      {
        officeId: office.id,
        userId: manager.id,
        name: "Risk Watchlist — Stale",
        filters: { status: "UNTOUCHED", sortBy: "updatedAt", sortDir: "asc", q: "", class1: "", class2: "", product: "", lane: "" }
      },
      {
        officeId: office.id,
        userId: manager.id,
        name: "China Import Pipeline",
        filters: { lane: "China Import", sortBy: "updatedAt", sortDir: "desc", q: "", status: "", class1: "", class2: "", product: "" }
      }
    ]
  });

  console.log("✓ Seed complete — Istanbul Office");
  console.log(`  Companies: ${companyList.length}`);
  console.log("  Admin:    admin@demo.local / admin1234");
  console.log("  Manager:  manager@demo.local / manager1234");
  console.log("  Sales:    sales1@demo.local / sales11234  …  sales8@demo.local / sales81234");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
