import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/test?sslmode=require";

const PCBA_SITE_TEXT = [
  "Arctic Circuits is a printed circuit board assembly contract manufacturer.",
  "We offer turnkey PCBA with SMT surface mount and through hole assembly, reflow, pick and place, and AOI inspection.",
  "Capability: 4 layer boards, fine pitch QFN and 0402 placement, ENIG or HASL finish, black solder mask.",
  "Request a quote by uploading your Gerber files. IPC-A-610 Class 3 and ISO 9001 certified.",
  "Prototype and low volume production runs ship from our Michigan plant.",
  "Contact sales@arcticcircuits.example for quotations.",
].join(" ").padEnd(600, " ");

const FOAM_MOLDER_TEXT = [
  "Polymer Laboratories molds polyurethane and viscoelastic foam parts.",
  "Molded foam production uses in house tooling, aluminum molds, and poured in place foam cells.",
  "Our chemists formulate polyol and isocyanate systems to a target density and ILD for memory foam parts.",
  "Send us your CAD or STL and request a quote. We are an OEM contract manufacturer with two production lines.",
  "Mold design and tool build happen in our own tool shop.",
].join(" ").padEnd(600, " ");

const FOAM_CONVERTER_TEXT = [
  "Dallas Foam Fabricators cuts and laminates foam to size.",
  "We CNC route foam blocks, laminate sheets, and fabricate packaging inserts from polyurethane and polyethylene foam.",
  "Foam cut to size only. No molding. Fast turnaround on fabricated foam parts.",
  "Request a quote for your foam fabrication project.",
].join(" ").padEnd(600, " ");

const FOAM_RETAILER_TEXT = [
  "Shop mattresses and memory foam beds at unbeatable prices.",
  "Add to cart today, free shipping on all orders, 100 night sleep trial, bed frames also available.",
  "Our polyurethane memory foam mattress is molded for comfort.",
  "Customer reviews (482) rate our mattress in a box five stars.",
].join(" ").padEnd(600, " ");

async function main() {
  const {
    classifySupplierSourcingCategory,
    qualifySupplierSite,
    supplierSourcingQueries,
    SUPPLIER_SOURCING_CATEGORIES,
  } = await import("../src/lib/supply-os/supplier-sourcing-category");
  const {
    parseSourcingCommand,
    planSourcingCommand,
    runSourcingCommand,
    runQueuedSourcingWaveJob,
    SOURCING_COMMAND_MAX_PER_CATEGORY,
    SOURCING_COMMAND_SLICE,
    SOURCING_COMMAND_SLICE_BUDGET_MS,
    SOURCING_OUTAGE_RETRIES,
  } = await import("../src/lib/procurement-sourcing-command");
  const { MAX_DISCOVERY_CALL_MS } = await import("../src/lib/procurement-supplier-sourcing");

  // The exact operator phrase, plus the wording variants around it.
  const exact = parseSourcingCommand("find 100 more in each category and send");
  assert.ok(exact, "the exact operator phrase must parse");
  assert.equal(exact.perCategory, 100);
  assert.equal(exact.send, true);
  assert.equal(exact.scope, "each-category");
  assert.equal(parseSourcingCommand("find 40 more suppliers in each category")?.send, false);
  assert.equal(parseSourcingCommand("FIND 25 MORE IN EACH CATEGORY AND SEND")?.perCategory, 25);
  assert.equal(parseSourcingCommand("find 60 new manufacturers for each category then email them")?.send, true);
  assert.equal(
    parseSourcingCommand("find 500 more in each category and send")?.perCategory,
    SOURCING_COMMAND_MAX_PER_CATEGORY,
    "a wave stays inside the bounded per-category cap",
  );
  assert.equal(parseSourcingCommand("find more suppliers and send"), null, "a count is required");
  assert.equal(parseSourcingCommand("send the emails"), null, "a bare send instruction is not a wave");
  assert.equal(parseSourcingCommand("what did the 100 suppliers say"), null, "a question is not a command");
  assert.equal(
    parseSourcingCommand("find 100 more in each category and send me a summary")?.send,
    false,
    "asking for a summary is not authorization to mail suppliers",
  );
  assert.equal(
    parseSourcingCommand("find 100 more in each category and email me when done")?.send,
    false,
    "asking to be notified is not authorization to mail suppliers",
  );
  assert.equal(parseSourcingCommand("find 30 more in each category and send the RFQs")?.send, true);
  assert.equal(parseSourcingCommand(42), null, "only text can be a command");

  // Category classification and the capability gate.
  const pcba = classifySupplierSourcingCategory({ material: "Turnkey 4-layer PCBA", specification: null, notes: null });
  assert.equal(pcba?.key, "pcba");
  const foam = classifySupplierSourcingCategory({
    material: "Molded memory foam insert",
    specification: "Cast viscoelastic foam, 280 x 105 x 11.5 mm",
    notes: null,
  });
  assert.equal(foam?.key, "molded-foam");
  assert.equal(
    classifySupplierSourcingCategory({ material: "Anodized aluminum bracket", specification: null, notes: null }),
    null,
    "an unsupported material must not fall into a category, because it would have no capability gate",
  );

  assert.equal(qualifySupplierSite(pcba!, { text: PCBA_SITE_TEXT, emails: ["sales@arcticcircuits.example"] }).state, "QUALIFIED");
  const molder = qualifySupplierSite(foam!, { text: FOAM_MOLDER_TEXT, emails: ["rfq@polymerlabs.example"] });
  assert.equal(molder.state, "QUALIFIED", "a real molder qualifies");
  assert.ok(molder.state === "QUALIFIED" && molder.matched.length >= 3, "qualification records its evidence");
  const converter = qualifySupplierSite(foam!, { text: FOAM_CONVERTER_TEXT, emails: ["quotes@dallasfoam.example"] });
  assert.equal(converter.state, "REJECTED", "a foam cutter is not a molder");
  const retailer = qualifySupplierSite(foam!, { text: FOAM_RETAILER_TEXT, emails: ["help@sleepshop.example"] });
  assert.equal(retailer.state, "REJECTED", "a mattress storefront is not a producer");
  assert.equal(
    qualifySupplierSite(pcba!, { text: PCBA_SITE_TEXT, emails: [] }).state,
    "REJECTED",
    "a site with no published address cannot be mailed",
  );
  assert.equal(
    qualifySupplierSite(pcba!, { text: "PCB assembly", emails: ["a@b.example"] }).state,
    "REJECTED",
    "a page with almost no text cannot evidence capability",
  );

  for (const category of SUPPLIER_SOURCING_CATEGORIES) {
    const queries = supplierSourcingQueries(category, 0, 4);
    assert.equal(queries.length, 4, "a round must produce its queries");
    assert.equal(new Set(queries).size, 4, "queries inside a round must not repeat");
    const later = supplierSourcingQueries(category, 3, 4);
    assert.equal(later.some((query) => queries.includes(query)), false, "later rounds must widen the search");
    const phrasesReached = new Set<string>();
    for (let round = 0; round < 8; round += 1) {
      for (const query of supplierSourcingQueries(category, round, 2)) {
        const phrase = category.queries.find((candidate) => query.startsWith(candidate));
        if (phrase) phrasesReached.add(phrase);
      }
    }
    assert.equal(
      phrasesReached.size,
      category.queries.length,
      "sliced rounds must reach every curated phrase, not only the first ones",
    );
  }

  // The command runs one wave per category and only sends what the wave added.
  const requests = [
    { id: "order-pcba", material: "Turnkey 4-layer PCBA", specification: null, notes: null },
    { id: "order-foam", material: "Molded viscoelastic foam insert", specification: null, notes: null },
    { id: "order-bracket", material: "Anodized aluminum bracket", specification: null, notes: null },
    { id: "order-pcba-old", material: "PCBA rework", specification: null, notes: null },
  ];
  const list = async () => requests as never;
  const plan = await planSourcingCommand({ customerId: "customer-1", list });
  assert.deepEqual(plan.map((entry) => entry.orderId), ["order-pcba", "order-foam"]);

  const sourcingCalls: Array<{ orderId: string; target: number }> = [];
  const rfqCalls: Array<{ orderId: string; limit: number }> = [];
  const sourcing = async (input: { orderId: string; target: number }) => {
    sourcingCalls.push({ orderId: input.orderId, target: input.target });
    return {
      orderId: input.orderId,
      material: "m",
      category: "pcba" as const,
      target: input.target,
      added: input.orderId === "order-foam" ? 0 : 7,
      additions: [],
      examined: 30,
      rejected: [],
      queriesUsed: [],
      discoveryExhausted: false,
      timedOut: false,
      providerFailures: [],
    };
  };
  const rfq = async (input: { orderId: string; limit: number }) => {
    rfqCalls.push({ orderId: input.orderId, limit: input.limit });
    return {
      orderId: input.orderId,
      material: "m",
      attachments: ["hypnodreamz order 1 doc 1.png (image/png, 220 KB)"],
      withheldFiles: [],
      candidates: input.limit,
      sent: input.limit,
      alreadySent: 0,
      rejected: 0,
      unknown: 0,
      poolExhausted: false,
      outcomes: [],
    };
  };

  const unconfirmed = await runSourcingCommand({
    customerId: "customer-1",
    intent: { perCategory: 10, send: true, scope: "each-category" },
    confirmed: false,
    dependencies: { plan: async () => plan, sourcing, rfq },
  });
  assert.equal(unconfirmed.send, false, "an unconfirmed command must not send");
  assert.equal(rfqCalls.length, 0, "no supplier mail without the confirmation");
  assert.equal(unconfirmed.added, 7);

  const confirmed = await runSourcingCommand({
    customerId: "customer-1",
    intent: { perCategory: 10, send: true, scope: "each-category" },
    confirmed: true,
    dependencies: { plan: async () => plan, sourcing, rfq },
  });
  assert.equal(confirmed.sent, 7, "only the suppliers the wave added are mailed");
  assert.deepEqual(rfqCalls, [{ orderId: "order-pcba", limit: 7 }], "a category that added nothing sends nothing");
  assert.ok(
    confirmed.categories.every((entry) => entry.send === null || entry.send.attachments.length > 0),
    "a send outcome records the files it carried",
  );

  // A category scope runs that category alone, so a failed or slow category can
  // be retried without re-running the whole plan.
  const scopedCalls: Array<{ orderId: string; deadlineAt?: number | null }> = [];
  const scoped = await runSourcingCommand({
    customerId: "customer-1",
    onlyCategory: "molded-foam",
    budgetMs: 60_000,
    intent: { perCategory: 4, send: false, scope: "each-category" },
    confirmed: false,
    dependencies: {
      plan: async () => plan,
      sourcing: async (input: { orderId: string; target: number; deadlineAt?: number | null }) => {
        scopedCalls.push({ orderId: input.orderId, deadlineAt: input.deadlineAt });
        return sourcing(input);
      },
      rfq,
    },
  });
  assert.deepEqual(scopedCalls.map((call) => call.orderId), ["order-foam"], "a scoped run touches one category");
  assert.ok(
    typeof scopedCalls[0]!.deadlineAt === "number" && scopedCalls[0]!.deadlineAt > Date.now(),
    "a budgeted run hands the wave a deadline so the invocation is never killed mid write",
  );
  assert.equal(scoped.categories.length, 1);

  // Every category that runs gets room for a whole discovery call. Splitting the
  // slice budget evenly gave each category less than one web search, so every
  // discovery call was abandoned and the wave added nobody.
  const budgetCalls: Array<number | null | undefined> = [];
  await runSourcingCommand({
    customerId: "customer-1",
    budgetMs: SOURCING_COMMAND_SLICE_BUDGET_MS,
    intent: { perCategory: 10, send: false, scope: "each-category" },
    confirmed: false,
    dependencies: {
      plan: async () => plan,
      sourcing: async (input: { orderId: string; target: number; deadlineAt?: number | null }) => {
        budgetCalls.push(input.deadlineAt);
        return sourcing(input);
      },
      rfq,
    },
  });
  assert.ok(budgetCalls.length >= 1, "a budgeted plan still sources");
  for (const deadlineAt of budgetCalls) {
    assert.ok(
      typeof deadlineAt === "number" && deadlineAt - Date.now() >= MAX_DISCOVERY_CALL_MS,
      "a sourced category must have room for one discovery call",
    );
  }

  // The rotation puts the named category first, so a plan whose first category
  // eats the whole budget cannot starve the other one forever.
  sourcingCalls.length = 0;
  await runSourcingCommand({
    customerId: "customer-1",
    firstCategory: "molded-foam",
    intent: { perCategory: 10, send: false, scope: "each-category" },
    confirmed: false,
    dependencies: { plan: async () => plan, sourcing, rfq },
  });
  assert.deepEqual(
    sourcingCalls.map((call) => call.orderId),
    ["order-foam", "order-pcba"],
    "the rotated category is sourced first",
  );

  // A category owed nothing is finished, and a category owed less than the slice
  // must not overshoot its own target.
  sourcingCalls.length = 0;
  await runSourcingCommand({
    customerId: "customer-1",
    categoryTargets: { pcba: 0, "molded-foam": 3 },
    intent: { perCategory: 10, send: false, scope: "each-category" },
    confirmed: false,
    dependencies: { plan: async () => plan, sourcing, rfq },
  });
  assert.deepEqual(
    sourcingCalls,
    [{ orderId: "order-foam", target: 3 }],
    "a finished category is skipped and a partial count is not exceeded",
  );

  // Only a failure that can succeed later is worth another slice.
  const { SupplierSourcingError } = await import("@/lib/procurement-supplier-sourcing");
  const failWith = async (code: "not_found" | "unsupported_category" | "discovery_unavailable") => {
    const failed = await runSourcingCommand({
      customerId: "customer-1",
      onlyCategory: "pcba",
      intent: { perCategory: 10, send: false, scope: "each-category" },
      confirmed: false,
      dependencies: {
        plan: async () => plan,
        sourcing: (async () => {
          throw new SupplierSourcingError("failed", code);
        }) as never,
        rfq,
      },
    });
    return failed.categories[0]!.errorRetryable;
  };
  assert.equal(await failWith("discovery_unavailable"), true, "an unavailable provider is retryable");
  assert.equal(await failWith("not_found"), false, "a missing request fails the same way forever");
  assert.equal(await failWith("unsupported_category"), false, "an unsupported category is permanent");

  // A queued wave runs in slices and re-queues only while it keeps finding.
  const enqueued: Array<Record<string, unknown>> = [];
  const enqueueCalls: Array<{ dedupeKey?: string | null; ignoreJobId?: string | null }> = [];
  const enqueue = async (input: {
    payload: Record<string, unknown>;
    dedupeKey?: string | null;
    ignoreJobId?: string | null;
  }) => {
    enqueued.push(input.payload);
    enqueueCalls.push({ dedupeKey: input.dedupeKey, ignoreJobId: input.ignoreJobId });
    return { id: `job-${enqueued.length}` };
  };
  let sliceTarget = 0;
  await runQueuedSourcingWaveJob({
    officeId: "office-1",
    jobId: "job-running",
    payload: { customerId: "customer-1", workspaceId: "workspace-1", perCategory: 100, send: true, confirmed: true },
    dependencies: {
      run: async (input) => {
        sliceTarget = input.intent.perCategory;
        return {
          perCategory: input.intent.perCategory,
          send: true,
          categories: [{ category: "pcba" as const, orderId: "order-pcba", material: "m", wave: { added: 5 } as never, send: null, error: null }],
          added: 5,
          sent: 5,
        };
      },
      enqueue: enqueue as never,
    },
  });
  assert.equal(sliceTarget, SOURCING_COMMAND_SLICE, "a queued wave runs a bounded slice");
  assert.equal(enqueued.length, 1, "the remainder is queued to continue");
  // The slice added 5 of the 20 it asked for, for example because it ran out of
  // its time budget, so 95 are still owed rather than 80.
  assert.equal(enqueued[0]!.perCategory, 95, "the remainder credits the suppliers actually added");
  assert.equal(enqueued[0]!.confirmed, true, "the original authorization carries to the remainder");
  assert.equal(
    enqueueCalls[0]!.dedupeKey,
    "procurement-sourcing-wave:workspace-1",
    "a fresh instruction still joins the running wave",
  );
  assert.equal(
    enqueueCalls[0]!.ignoreJobId,
    "job-running",
    "the continuation must not dedupe against the job that is queueing it",
  );

  enqueued.length = 0;
  await runQueuedSourcingWaveJob({
    officeId: "office-1",
    payload: { customerId: "customer-1", workspaceId: "workspace-1", perCategory: 100, send: false, confirmed: false },
    dependencies: {
      run: async () => ({
        perCategory: SOURCING_COMMAND_SLICE,
        send: false,
        categories: [{
          category: "pcba" as const,
          orderId: "order-pcba",
          material: "m",
          wave: { added: 0, discoveryExhausted: true } as never,
          send: null,
          error: null,
        }],
        added: 0,
        sent: 0,
        skipped: [],
      }),
      enqueue: enqueue as never,
    },
  });
  assert.equal(enqueued.length, 0, "a category with no phrases left must not re-queue forever");

  // A barren slice that still has curated phrases left has to carry on, and the
  // continuation has to start where the last slice stopped searching, otherwise
  // every slice repeats the first phrases and proposes only known domains.
  enqueued.length = 0;
  const startRoundsSeen: Array<unknown> = [];
  await runQueuedSourcingWaveJob({
    officeId: "office-1",
    payload: {
      customerId: "customer-1",
      workspaceId: "workspace-1",
      perCategory: 100,
      send: false,
      confirmed: false,
      startRounds: { pcba: 4 },
    },
    dependencies: {
      run: async (input) => {
        startRoundsSeen.push(input.startRounds);
        return {
          perCategory: SOURCING_COMMAND_SLICE,
          send: false,
          categories: [{
            category: "pcba" as const,
            orderId: "order-pcba",
            material: "m",
            wave: { added: 0, discoveryExhausted: false, nextRound: 9 } as never,
            send: null,
            error: null,
          }],
          added: 0,
          sent: 0,
          skipped: [],
        };
      },
      enqueue: enqueue as never,
    },
  });
  assert.deepEqual(
    startRoundsSeen[0],
    { pcba: 4 },
    "a continuation resumes the phrases the payload recorded",
  );
  assert.equal(enqueued.length, 1, "unsearched phrases keep the wave going");
  assert.deepEqual(
    enqueued[0]!.startRounds,
    { pcba: 9 },
    "the next slice starts where this one stopped searching",
  );

  // A slice hands the whole budget to one category, so the category that never
  // got its turn has to go first next time. Without this the plan order alone
  // decides and the second category is never sourced at all.
  enqueued.length = 0;
  const firstSeen: Array<unknown> = [];
  await runQueuedSourcingWaveJob({
    officeId: "office-1",
    payload: { customerId: "customer-1", workspaceId: "workspace-1", perCategory: 100, send: false, confirmed: false },
    dependencies: {
      run: async (input) => {
        firstSeen.push(input.firstCategory ?? null);
        return {
          perCategory: SOURCING_COMMAND_SLICE,
          send: false,
          categories: [{
            category: "molded-foam" as const,
            orderId: "order-foam",
            material: "m",
            // This category is finished, and on its own that would end the wave
            // while the skipped one still holds nobody.
            wave: { added: 0, discoveryExhausted: true, nextRound: 7 } as never,
            send: null,
            error: null,
          }],
          added: 0,
          sent: 0,
          skipped: ["pcba" as const],
        };
      },
      enqueue: enqueue as never,
    },
  });
  assert.deepEqual(firstSeen, [null], "the first slice follows the plan order");
  assert.equal(enqueued.length, 1, "a category that never ran keeps the wave going");
  assert.equal(
    enqueued[0]!.firstCategory,
    "pcba",
    "the starved category takes the next budget",
  );
  assert.deepEqual(
    enqueued[0]!.remaining,
    { "molded-foam": 0, pcba: 100 },
    "only the category that ran spends its own count, and a spent category is owed nothing",
  );

  // Alternating slices must not share one remainder, otherwise each category
  // stops at about half the target. The count each category still owes travels
  // in the payload and only the category that ran is charged.
  enqueued.length = 0;
  const targetsSeen: Array<unknown> = [];
  await runQueuedSourcingWaveJob({
    officeId: "office-1",
    payload: {
      customerId: "customer-1",
      workspaceId: "workspace-1",
      perCategory: 60,
      send: false,
      confirmed: false,
      remaining: { pcba: 60, "molded-foam": 25 },
    },
    dependencies: {
      run: async (input) => {
        targetsSeen.push(input.categoryTargets);
        return {
          perCategory: SOURCING_COMMAND_SLICE,
          send: false,
          categories: [{
            category: "pcba" as const,
            orderId: "order-pcba",
            material: "m",
            wave: { added: SOURCING_COMMAND_SLICE, discoveryExhausted: false, nextRound: 3 } as never,
            send: null,
            error: null,
          }],
          added: SOURCING_COMMAND_SLICE,
          sent: 0,
          skipped: ["molded-foam" as const],
        };
      },
      enqueue: enqueue as never,
    },
  });
  assert.deepEqual(
    targetsSeen[0],
    { pcba: 60, "molded-foam": 25 },
    "a slice sources against the count each category still owes",
  );
  assert.deepEqual(
    enqueued[0]!.remaining,
    { pcba: 60 - SOURCING_COMMAND_SLICE, "molded-foam": 25 },
    "the category that sat out keeps its whole count",
  );
  assert.equal(
    enqueued[0]!.perCategory,
    60 - SOURCING_COMMAND_SLICE,
    "the payload target follows the largest count still owed",
  );

  // A category whose sourcing threw never searched, so its count has to survive
  // untouched, otherwise repeated failures drain a target nobody sourced.
  enqueued.length = 0;
  await runQueuedSourcingWaveJob({
    officeId: "office-1",
    payload: {
      customerId: "customer-1",
      workspaceId: "workspace-1",
      perCategory: 60,
      send: false,
      confirmed: false,
      remaining: { pcba: 60, "molded-foam": 25 },
    },
    dependencies: {
      run: async () => ({
        perCategory: SOURCING_COMMAND_SLICE,
        send: false,
        categories: [
          {
            category: "pcba" as const,
            orderId: "order-pcba",
            material: "m",
            wave: null,
            send: null,
            error: "discovery failed",
            errorRetryable: true,
          },
          {
            category: "molded-foam" as const,
            orderId: "order-foam",
            material: "m",
            wave: { added: 4, discoveryExhausted: false, nextRound: 3 } as never,
            send: null,
            error: null,
          },
        ],
        added: 4,
        sent: 0,
        skipped: [],
      }),
      enqueue: enqueue as never,
    },
  });
  assert.deepEqual(
    enqueued[0]!.remaining,
    { pcba: 60, "molded-foam": 21 },
    "a failed category keeps its count while the category that ran is charged",
  );

  // A permanent failure is different: the wave stays alive for the other
  // category, so the broken one has to leave the count or every slice retries
  // the same failure.
  enqueued.length = 0;
  await runQueuedSourcingWaveJob({
    officeId: "office-1",
    payload: {
      customerId: "customer-1",
      workspaceId: "workspace-1",
      perCategory: 60,
      send: false,
      confirmed: false,
      remaining: { pcba: 60, "molded-foam": 25 },
    },
    dependencies: {
      run: async () => ({
        perCategory: SOURCING_COMMAND_SLICE,
        send: false,
        categories: [
          {
            category: "pcba" as const,
            orderId: "order-pcba",
            material: "m",
            wave: null,
            send: null,
            error: "The sourcing request was not found.",
            errorRetryable: false,
          },
          {
            category: "molded-foam" as const,
            orderId: "order-foam",
            material: "m",
            wave: { added: 4, discoveryExhausted: false, nextRound: 3 } as never,
            send: null,
            error: null,
          },
        ],
        added: 4,
        sent: 0,
        skipped: [],
      }),
      enqueue: enqueue as never,
    },
  });
  assert.deepEqual(
    enqueued[0]!.remaining,
    { pcba: 0, "molded-foam": 21 },
    "a permanently failed category leaves the count instead of being retried every slice",
  );

  // A scoped job whose only category throws still owes its whole count, so the
  // failure is retried on a delay a bounded number of times.
  const failScoped = async (retries: number, retryable = true) => {
    enqueued.length = 0;
    await runQueuedSourcingWaveJob({
      officeId: "office-1",
      payload: {
        customerId: "customer-1",
        workspaceId: "workspace-1",
        perCategory: 60,
        category: "pcba",
        send: false,
        confirmed: false,
        providerRetries: retries,
      },
      dependencies: {
        run: async () => ({
          perCategory: SOURCING_COMMAND_SLICE,
          send: false,
          categories: [{
            category: "pcba" as const,
            orderId: "order-pcba",
            material: "m",
            wave: null,
            send: null,
            error: "discovery failed",
            errorRetryable: retryable,
          }],
          added: 0,
          sent: 0,
          skipped: [],
        }),
        enqueue: enqueue as never,
      },
    });
  };
  await failScoped(0);
  assert.equal(enqueued.length, 1, "a scoped category failure is retried instead of ending the wave");
  assert.equal(enqueued[0]!.providerRetries, 1, "the retry is counted");
  await failScoped(SOURCING_OUTAGE_RETRIES);
  assert.equal(enqueued.length, 0, "a category that keeps failing stops once the retries are spent");
  await failScoped(0, false);
  assert.equal(
    enqueued.length,
    0,
    "a permanent failure, a missing request or an unsupported category, is not retried",
  );

  // A slice that spent its whole budget before qualifying anyone still owes the
  // rest of the count, so the wave has to continue rather than quietly stop.
  enqueued.length = 0;
  await runQueuedSourcingWaveJob({
    officeId: "office-1",
    payload: { customerId: "customer-1", workspaceId: "workspace-1", perCategory: 100, send: false, confirmed: false },
    dependencies: {
      run: async () => ({
        perCategory: SOURCING_COMMAND_SLICE,
        send: false,
        categories: [{
          category: "pcba" as const,
          orderId: "order-pcba",
          material: "m",
          wave: { added: 0, timedOut: true } as never,
          send: null,
          error: null,
        }],
        added: 0,
        sent: 0,
        skipped: [],
      }),
      enqueue: enqueue as never,
    },
  });
  assert.equal(enqueued.length, 1, "a slice that ran out of time keeps the wave going");
  assert.equal(enqueued[0]!.perCategory, 99, "the timed out slice only credits real progress");

  // Every discovery provider down is an outage, not an exhausted category, so
  // the same count is retried on a delay until the attempts run out.
  const outageSlice = (providerRetries?: number) => ({
    officeId: "office-1",
    payload: {
      customerId: "customer-1",
      workspaceId: "workspace-1",
      perCategory: 100,
      send: false,
      confirmed: false,
      ...(providerRetries === undefined ? {} : { providerRetries }),
    },
    dependencies: {
      run: async () => ({
        perCategory: SOURCING_COMMAND_SLICE,
        send: false,
        categories: [{
          category: "pcba" as const,
          orderId: "order-pcba",
          material: "m",
          wave: {
            added: 0,
            timedOut: false,
            discoveryExhausted: true,
            providerFailures: ["serper", "openai"],
          } as never,
          send: null,
          error: null,
        }],
        added: 0,
        sent: 0,
        skipped: [],
      }),
      enqueue: enqueue as never,
    },
  });
  enqueued.length = 0;
  enqueueCalls.length = 0;
  const outageEnqueue: Array<{ runAfter?: Date }> = [];
  await runQueuedSourcingWaveJob({
    ...outageSlice(),
    dependencies: {
      ...outageSlice().dependencies,
      enqueue: (async (input: { payload: Record<string, unknown>; runAfter?: Date }) => {
        enqueued.push(input.payload);
        outageEnqueue.push({ runAfter: input.runAfter });
        return { id: "job-outage" };
      }) as never,
    },
  });
  assert.equal(enqueued.length, 1, "a discovery outage retries instead of abandoning the wave");
  assert.equal(enqueued[0]!.perCategory, 100, "the retry still owes the whole remaining count");
  assert.equal(enqueued[0]!.providerRetries, 1, "the retry attempt is counted");
  assert.ok(outageEnqueue[0]!.runAfter instanceof Date, "the retry waits for the provider to recover");

  enqueued.length = 0;
  await runQueuedSourcingWaveJob(outageSlice(SOURCING_OUTAGE_RETRIES) as never);
  assert.equal(enqueued.length, 0, "the outage retries are bounded, so the chain cannot run forever");

  await assert.rejects(
    runQueuedSourcingWaveJob({ officeId: "office-1", payload: { workspaceId: "workspace-1", perCategory: 10 } }),
    /customer/i,
    "a job without a customer must fail loudly",
  );

  // Category file policy: the board package never reaches a molder and the mold
  // geometry never reaches a board shop, whatever a request happens to link.
  const { categoryAllowsRfqFile } = await import("../src/lib/procurement-rfq-attachments");
  assert.equal(categoryAllowsRfqFile("pcba", "hypnodreamz order 1 doc 1.png"), true);
  assert.equal(categoryAllowsRfqFile("pcba", "hypnodreamz order 1 doc 2.csv"), true);
  assert.equal(categoryAllowsRfqFile("pcba", "hypnodreamz order 1 doc 2.stl"), false);
  assert.equal(categoryAllowsRfqFile("molded-foam", "hypnodreamz order 1 doc 2.stl"), true);
  assert.equal(categoryAllowsRfqFile("molded-foam", "hypnodreamz order 1 doc 4.STL"), true);
  assert.equal(categoryAllowsRfqFile("molded-foam", "hypnodreamz order 1 doc 2.csv"), false, "the BOM stays off a foam enquiry");
  assert.equal(categoryAllowsRfqFile(null, "anything.bin"), true, "an unclassified request keeps its own file scope");

  // A confirmed send has to reach the suppliers this wave found, not whichever
  // uncontacted rows are oldest on the request.
  const targetedRfqCalls: Array<{ vendorIds?: readonly string[] | null }> = [];
  await runSourcingCommand({
    customerId: "customer-1",
    intent: { perCategory: 2, send: true, scope: "each-category" },
    confirmed: true,
    dependencies: {
      plan: async () => [{ orderId: "order-pcba", material: "PCBA", category: "pcba" as const }],
      sourcing: async () => ({
        added: 2,
        additions: [{ vendorId: "vendor-new-1" }, { vendorId: "vendor-new-2" }],
      } as never),
      rfq: (async (input: { vendorIds?: readonly string[] | null }) => {
        targetedRfqCalls.push({ vendorIds: input.vendorIds });
        return { sent: 2, attachments: [], withheldFiles: [] };
      }) as never,
    },
  });
  assert.deepEqual(
    [...(targetedRfqCalls[0]!.vendorIds ?? [])],
    ["vendor-new-1", "vendor-new-2"],
    "the campaign is restricted to the vendors the wave added",
  );

  // The standing status is what the operator reads while a queued wave grinds
  // through its slices, so it has to report real supplier counts and the work
  // the queue still owes.
  const { sourcingCommandStatus, countSupplierDeliveries } =
    await import("../src/lib/procurement-sourcing-command");

  // The workflow write back is best effort, so a RECORDED local receipt also
  // proves delivery, a supplier in both stores counts once, and a RESERVED row
  // is only an in-flight or unreconciled send, never a contacted supplier.
  assert.deepEqual(
    countSupplierDeliveries(
      [
        { vendorId: "vendor-1", lastEmailMessageId: "<a@derya>" },
        { vendorId: "vendor-2", lastEmailMessageId: null },
        { vendorId: "vendor-3", lastEmailMessageId: "<c@derya>" },
        { vendorId: "vendor-4", lastEmailMessageId: null },
        { vendorId: "vendor-5", lastEmailMessageId: null },
      ],
      { recorded: new Set(["vendor-2", "vendor-3"]), reserved: new Set(["vendor-3", "vendor-4"]) },
    ),
    { contacted: 3, pending: 1 },
    "a recorded receipt counts once and a reserved send stays pending",
  );

  const status = await sourcingCommandStatus({
    customerId: "customer-1",
    workspaceId: "workspace-1",
    plan: (async () => [
      { orderId: "order-pcba", material: "PCBA", category: "pcba" as const },
      { orderId: "order-foam", material: "Custom memory foam parts", category: "molded-foam" as const },
    ]) as never,
    officeId: "office-1",
    counts: async ({ orderId, officeId }) => {
      assert.equal(officeId, "office-1", "supplier counts stay inside the owning office");
      return orderId === "order-pcba"
        ? { suppliers: 214, contacted: 210, pending: 2 }
        : { suppliers: 118, contacted: 118, pending: 0 };
    },
    jobs: async ({ officeId }) => {
      assert.equal(officeId, "office-1", "queued work is read inside the owning office only");
      return [{
        id: "job-next",
        status: "QUEUED",
        payload: { perCategory: 40, startRounds: { pcba: 12 }, providerRetries: 0 },
        runAfter: new Date("2026-09-01T00:00:00.000Z"),
        lastError: null,
      }];
    },
  });
  assert.deepEqual(
    status.categories.map((entry) => [
      entry.category,
      entry.suppliers,
      entry.contacted,
      entry.pendingDelivery,
      entry.uncontacted,
    ]),
    [["pcba", 214, 210, 2, 2], ["molded-foam", 118, 118, 0, 0]],
    "each category reports how many suppliers it holds and how many were mailed",
  );
  assert.equal(status.queued.length, 1, "a continuation still owed is visible");
  assert.equal(status.queued[0]!.remainingPerCategory, 40, "the remaining count is reported");
  assert.deepEqual(status.queued[0]!.startRounds, { pcba: 12 }, "the search phrase cursor is reported");
  assert.deepEqual(
    status.queued[0]!.remainingByCategory,
    { pcba: 40, "molded-foam": 40 },
    "a job that has not written per category counts yet still owes each category its target",
  );

  const scopedStatus = await sourcingCommandStatus({
    customerId: "customer-1",
    workspaceId: "workspace-1",
    plan: (async () => [
      { orderId: "order-pcba", material: "PCBA", category: "pcba" as const },
      { orderId: "order-foam", material: "Custom memory foam parts", category: "molded-foam" as const },
    ]) as never,
    officeId: "office-1",
    counts: async () => ({ suppliers: 0, contacted: 0, pending: 0 }),
    jobs: async () => [
      {
        id: "job-scoped",
        status: "QUEUED",
        payload: { perCategory: 40, category: "pcba" },
        runAfter: new Date("2026-09-01T00:00:00.000Z"),
        lastError: null,
      },
      {
        id: "job-progressed",
        status: "QUEUED",
        payload: { perCategory: 40, remaining: { pcba: 30, "molded-foam": 0 } },
        runAfter: new Date("2026-09-01T00:00:00.000Z"),
        lastError: null,
      },
    ],
  });
  assert.deepEqual(
    scopedStatus.queued[0]!.remainingByCategory,
    { pcba: 40 },
    "a category scoped job owes nothing outside its own category",
  );
  assert.deepEqual(
    scopedStatus.queued[1]!.remainingByCategory,
    { pcba: 30, "molded-foam": 0 },
    "counts written by an earlier slice win, including a finished category",
  );

  console.log("procurement sourcing command contract passed");
}

void main();
