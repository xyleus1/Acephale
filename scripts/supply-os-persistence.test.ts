import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import {
  createSupplyWorkspace,
  getSupplyWorkspace,
  listSupplyWorkspaces,
  publishSupplyImport,
  stageSupplyCsvImport,
  type SupplyAccessContext,
} from "../src/lib/supply-os/persistence";

const suffix = randomUUID().slice(0, 8);
let officeId = "";
let foreignOfficeId = "";

async function cleanup() {
  const officeIds = [officeId, foreignOfficeId].filter(Boolean);
  if (!officeIds.length) return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL derya.allow_supply_snapshot_mutation = 'on'");
    await tx.office.deleteMany({ where: { id: { in: officeIds } } });
  }).catch(() => undefined);
}

async function main() {
try {
  const office = await prisma.office.create({ data: { name: `Supply Verify ${suffix}` } });
  officeId = office.id;
  const owner = await prisma.user.create({
    data: {
      officeId,
      email: `owner-${suffix}@example.test`,
      passwordHash: "verification-only",
      fullName: "Supply Owner",
      role: "ADMIN",
      canViewWholeOffice: true,
    },
  });
  const context: SupplyAccessContext = {
    officeId,
    userId: owner.id,
    role: owner.role,
    canViewWholeOffice: owner.canViewWholeOffice,
  };

  const workspace = await createSupplyWorkspace(context, { name: "Robotics program" });
  assert.equal(workspace.members[0]?.role, "OWNER");

  const files = {
    locations: "location_key,name,kind,country_code\nAUS,Austin Assembly,FACTORY,US",
    items: "item_key,name,item_type,unit\nROBOT-1,Warehouse Robot,PRODUCT,EA\nRADIO-1,Radio Module,COMPONENT,EA",
    bom: "parent_item_key,component_item_key,quantity,unit\nROBOT-1,RADIO-1,1,EA",
    inventory: "position_key,item_key,location_key,on_hand,allocated,unit,as_of\nINV-1,RADIO-1,AUS,24,4,EA,2026-08-08",
    demand: "demand_key,item_key,location_key,quantity,unit,due_at\nDEM-1,ROBOT-1,AUS,30,EA,2026-09-01",
    purchase_orders: "purchase_order_key,line_key,item_key,location_key,supplier_name,quantity,unit,expected_at,status\nPO-1,1,RADIO-1,AUS,Acme,10,EA,2026-08-20,OPEN",
    supplier_terms: "term_key,item_key,supplier_name,supplier_website,supplier_role,price,currency,moq,lead_time_days,evidence_url,observed_at\nTERM-1,RADIO-1,Acme,https://acme.example,MANUFACTURER,42,USD,10,21,https://acme.example/rm9,2026-08-01",
    compliance_records: "record_key,item_key,authority,standard,evidence_url,observed_at,review_state\nFCC-1,RADIO-1,FCC,Part 15,https://fcc.example/rule,2026-08-01,REVIEW_REQUIRED",
  } as const;

  const staged = await stageSupplyCsvImport(context, workspace.id, { sourceName: "Verification bundle", files });
  assert.equal(staged.status, "READY");
  assert.equal(staged.snapshot?.status, "DRAFT");

  const replay = await stageSupplyCsvImport(context, workspace.id, { sourceName: "Verification bundle", files });
  assert.equal(replay.id, staged.id, "identical imports must be idempotent");
  const reorderedReplay = await stageSupplyCsvImport(context, workspace.id, {
    sourceName: "Reordered verification bundle",
    files: {
      ...files,
      items: [files.items.split("\n")[0]!, ...files.items.split("\n").slice(1).reverse()].join("\n"),
    },
  });
  assert.equal(reorderedReplay.id, staged.id, "row ordering must not change normalized import identity");

  const published = await publishSupplyImport(context, staged.id);
  assert.equal(published.status, "PUBLISHED");
  assert.equal(published.snapshot?.status, "PUBLISHED");

  const loaded = await getSupplyWorkspace(context, workspace.id);
  const snapshot = loaded.snapshots[0];
  assert.equal(snapshot?.items.length, 2);
  assert.equal(snapshot?.locations.length, 1);
  assert.equal(snapshot?.bomVersions[0]?.lines.length, 1);
  assert.equal(snapshot?.inventory.length, 1);
  assert.equal(snapshot?.demands.length, 1);
  const metadata = snapshot?.metadata as { purchaseOrders?: unknown[]; supplierTerms?: unknown[]; complianceRecords?: unknown[] };
  assert.equal(metadata.purchaseOrders?.length, 1);
  assert.equal(metadata.supplierTerms?.length, 1);
  assert.equal(metadata.complianceRecords?.length, 1);

  const listed = await listSupplyWorkspaces(context);
  assert.ok(listed.some((candidate) => candidate.id === workspace.id));

  const employee = await prisma.user.create({
    data: {
      officeId,
      email: `employee-${suffix}@example.test`,
      passwordHash: "verification-only",
      fullName: "Restricted Operator",
      role: "EMPLOYEE",
      canViewWholeOffice: true,
    },
  });
  const employeeContext: SupplyAccessContext = {
    officeId,
    userId: employee.id,
    role: employee.role,
    canViewWholeOffice: employee.canViewWholeOffice,
  };
  assert.equal(
    (await listSupplyWorkspaces(employeeContext)).some((candidate) => candidate.id === workspace.id),
    false,
    "employee office-wide flags must not bypass workspace membership",
  );
  await assert.rejects(() => getSupplyWorkspace(employeeContext, workspace.id), /not found/i);
  await prisma.supplyWorkspaceMember.create({
    data: { officeId, workspaceId: workspace.id, userId: employee.id, role: "MEMBER" },
  });
  assert.ok((await listSupplyWorkspaces(employeeContext)).some((candidate) => candidate.id === workspace.id));
  assert.equal((await getSupplyWorkspace(employeeContext, workspace.id)).id, workspace.id);
  await assert.rejects(
    () => stageSupplyCsvImport(employeeContext, workspace.id, { sourceName: "Forbidden employee import", files }),
    /cannot edit/i,
  );

  const foreignOffice = await prisma.office.create({ data: { name: `Foreign Supply Verify ${suffix}` } });
  foreignOfficeId = foreignOffice.id;
  const foreignUser = await prisma.user.create({
    data: {
      officeId: foreignOfficeId,
      email: `foreign-${suffix}@example.test`,
      passwordHash: "verification-only",
      fullName: "Foreign Operator",
      role: "MANAGER",
    },
  });
  await assert.rejects(
    () => prisma.supplyWorkspaceMember.create({
      data: { officeId, workspaceId: workspace.id, userId: foreignUser.id, role: "MEMBER" },
    }),
    /office scope/i,
  );
  await assert.rejects(
    () => prisma.supplyWorkspace.update({
      where: { id: workspace.id },
      data: { createdByUserId: foreignUser.id },
    }),
    /office scope/i,
  );

  const secondImport = await stageSupplyCsvImport(context, workspace.id, {
    sourceName: "Cross-snapshot verification bundle",
    files: { ...files, demand: files.demand.replace("30,EA", "31,EA") },
  });
  const secondLocation = await prisma.supplyLocation.findFirstOrThrow({
    where: { snapshotId: secondImport.snapshot!.id },
  });
  await assert.rejects(
    () => prisma.supplyInventoryPosition.create({
      data: {
        officeId,
        workspaceId: workspace.id,
        snapshotId: secondImport.snapshot!.id,
        positionKey: `CROSS-SNAPSHOT-${suffix}`,
        itemId: snapshot!.items[0]!.id,
        locationId: secondLocation.id,
        unitOfMeasure: "EA",
        quantityOnHand: 1,
        asOf: new Date("2026-08-08T00:00:00.000Z"),
      },
    }),
    /snapshot scope/i,
  );

  await assert.rejects(
    () => prisma.supplyItem.update({
      where: { id: snapshot!.items[0]!.id },
      data: { name: "Mutation should fail" },
    }),
    /immutable/i,
  );

  console.log("Supply OS persistence contract passed.");
} finally {
  await cleanup();
  await prisma.$disconnect();
}
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
