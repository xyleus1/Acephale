import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import {
  createSupplyWorkspace,
  getSupplyWorkspace,
  latestPublishedSnapshotForParts,
  normalizedSupplySourceHash,
  publishSupplyImport,
  stageNormalizedSupplySnapshot,
  stageSupplyCsvImport,
  type SupplyAccessContext,
} from "../src/lib/supply-os/persistence";
import {
  CUSTOMER_BASE_LOCATION_KEY,
  deleteManagedSupplyItem,
  getSupplyWorkspaceManagement,
  updateManagedSupplyItem,
  updateSupplyWorkspaceManagement,
  updateSupplyWorkspaceWebsite,
} from "../src/lib/supply-os/workspace-management";

assert(process.env.DATABASE_URL, "DATABASE_URL is required for the workspace management database test.");

const suffix = randomUUID().slice(0, 8);
const officeIds: string[] = [];

async function cleanup() {
  if (!officeIds.length) return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL derya.allow_supply_snapshot_mutation = 'on'");
    await tx.office.deleteMany({ where: { id: { in: officeIds } } });
  }).catch(() => undefined);
  await prisma.$disconnect();
}

async function main() {
  try {
    const [office, foreignOffice] = await Promise.all([
      prisma.office.create({ data: { name: `Workspace management ${suffix}` } }),
      prisma.office.create({ data: { name: `Foreign workspace management ${suffix}` } }),
    ]);
    officeIds.push(office.id, foreignOffice.id);
    const [admin, editor, viewer, foreignAdmin, company, otherCompany] = await Promise.all([
      prisma.user.create({ data: { officeId: office.id, email: `admin-${suffix}@example.test`, passwordHash: "test", fullName: "Admin", role: "ADMIN", canViewWholeOffice: true } }),
      prisma.user.create({ data: { officeId: office.id, email: `editor-${suffix}@example.test`, passwordHash: "test", fullName: "Editor", role: "ADMIN", canViewWholeOffice: false } }),
      prisma.user.create({ data: { officeId: office.id, email: `viewer-${suffix}@example.test`, passwordHash: "test", fullName: "Viewer", role: "ADMIN", canViewWholeOffice: false } }),
      prisma.user.create({ data: { officeId: foreignOffice.id, email: `foreign-${suffix}@example.test`, passwordHash: "test", fullName: "Foreign", role: "ADMIN", canViewWholeOffice: true } }),
      prisma.company.create({ data: { officeId: office.id, name: `Managed company ${suffix}`, crmStage: "active" } }),
      prisma.company.create({ data: { officeId: office.id, name: `Other company ${suffix}`, crmStage: "active" } }),
    ]);
    const adminContext: SupplyAccessContext = {
      officeId: office.id,
      userId: admin.id,
      role: "ADMIN",
      canViewWholeOffice: true,
    };
    const workspace = await createSupplyWorkspace(adminContext, { name: company.name, companyId: company.id });
    const otherWorkspace = await createSupplyWorkspace(adminContext, { name: otherCompany.name, companyId: otherCompany.id });
    await prisma.supplyWorkspaceMember.createMany({
      data: [
        { officeId: office.id, workspaceId: workspace.id, userId: editor.id, role: "EDITOR" },
        { officeId: office.id, workspaceId: workspace.id, userId: viewer.id, role: "VIEWER" },
      ],
    });
    const editorContext: SupplyAccessContext = {
      officeId: office.id,
      userId: editor.id,
      role: "CUSTOMER",
      canViewWholeOffice: false,
      accessKind: "customer",
      restrictedWorkspaceIds: [workspace.id],
    };
    const viewerContext: SupplyAccessContext = {
      ...editorContext,
      userId: viewer.id,
    };
    const foreignContext: SupplyAccessContext = {
      officeId: foreignOffice.id,
      userId: foreignAdmin.id,
      role: "ADMIN",
      canViewWholeOffice: true,
    };

    const staged = await stageSupplyCsvImport(adminContext, workspace.id, {
      sourceName: "Management fixture",
      files: {
        locations: "location_key,name,kind,address,city,country_code\ncustomer-base,CSV supplied base,FACTORY,9 Wrong St,Austin,US",
        items: "item_key,name,item_type,unit\nPRODUCT,Finished product,PRODUCT,EA\nPART,Managed part,COMPONENT,EA\nKEEP,Unrelated part,COMPONENT,EA",
        bom: "parent_item_key,component_item_key,quantity,unit\nPRODUCT,PART,1,EA\nPRODUCT,KEEP,2,EA",
        inventory: "position_key,item_key,location_key,on_hand,allocated,unit,as_of\nINV-PART,PART,customer-base,3,0,EA,2026-08-23\nINV-KEEP,KEEP,customer-base,7,0,EA,2026-08-23",
        demand: "demand_key,item_key,location_key,quantity,unit,due_at\nDEM-PRODUCT,PRODUCT,customer-base,5,EA,2026-09-30\nDEM-KEEP,KEEP,customer-base,2,EA,2026-09-20",
        supplier_terms: "term_key,item_key,supplier_name,price,currency,moq,lead_time_days\nTERM-PART,PART,Part supplier,10,USD,1,7\nTERM-KEEP,KEEP,Keep supplier,20,USD,1,8",
      },
    });
    await publishSupplyImport(adminContext, staged.id);

    assert.equal((await getSupplyWorkspaceManagement(editorContext, workspace.id)).logisticsReady, false);
    const initialSnapshotVersion = (await getSupplyWorkspace(adminContext, workspace.id)).snapshots[0]?.version;
    await assert.rejects(
      () => updateSupplyWorkspaceManagement(viewerContext, workspace.id, {
        base: { name: "Blocked", addressLine: "1 Main St", city: "Austin", countryCode: "US" },
      }),
      /cannot edit/i,
    );
    await assert.rejects(
      () => updateManagedSupplyItem(viewerContext, workspace.id, "PART", {
        name: "Blocked edit",
        unitOfMeasure: "EA",
      }),
      /cannot edit/i,
    );
    await assert.rejects(
      () => deleteManagedSupplyItem(viewerContext, workspace.id, "PART"),
      /cannot edit/i,
    );
    assert.equal((await getSupplyWorkspace(adminContext, workspace.id)).snapshots[0]?.version, initialSnapshotVersion);
    await assert.rejects(
      () => getSupplyWorkspaceManagement(editorContext, otherWorkspace.id),
      /not found/i,
    );
    await assert.rejects(
      () => updateSupplyWorkspaceManagement(editorContext, otherWorkspace.id, {
        base: { name: "Blocked", addressLine: "1 Main St", city: "Austin", countryCode: "US" },
      }),
      /not found/i,
    );
    await assert.rejects(
      () => deleteManagedSupplyItem(editorContext, otherWorkspace.id, "PART"),
      /not found/i,
    );
    assert.equal((await prisma.supplySnapshot.count({ where: { workspaceId: otherWorkspace.id } })), 0);
    await assert.rejects(
      () => getSupplyWorkspaceManagement(foreignContext, workspace.id),
      /not found/i,
    );

    await updateSupplyWorkspaceWebsite(editorContext, workspace.id, { website: "managed.example.com" });
    const settings = await updateSupplyWorkspaceManagement(editorContext, workspace.id, {
      base: {
        name: "Austin receiving",
        addressLine: "1 Main St",
        city: "Austin",
        region: "TX",
        postalCode: "78701",
        countryCode: "us",
      },
    });
    assert.equal(settings.logisticsReady, true);
    assert.equal(settings.website, "https://managed.example.com/");
    assert.equal(settings.base?.countryCode, "US");

    await updateManagedSupplyItem(editorContext, workspace.id, "PART", {
      name: "Configured part",
      description: "Grade A, drawing 42",
      manufacturer: "Maker",
      mpn: "MPN-42",
      unitOfMeasure: "EA",
      requestedQuantity: 12,
      requestedUnit: "EA",
      deliveryLocation: "Austin receiving",
      needByDate: "2026-09-15",
    });
    let loaded = await getSupplyWorkspace(editorContext, workspace.id);
    assert.equal(loaded.snapshots[0]?.version, 3);
    assert.equal(loaded.snapshots[0]?.locations.some((location) => location.locationKey === CUSTOMER_BASE_LOCATION_KEY), true);
    const configured = loaded.snapshots[0]?.items.find((item) => item.itemKey === "PART");
    assert.equal(configured?.name, "Configured part");
    assert.equal((configured?.metadata as { request?: { quantity?: number } }).request?.quantity, 12);
    const configuredSources = configured?.sourceRefs as Array<{ source?: string }>;
    assert.equal(configuredSources.some((source) => source.source === "CSV"), true);
    assert.equal(configuredSources.some((source) => source.source === "CUSTOMER_MANAGED"), true);

    const staleNormalized = await latestPublishedSnapshotForParts(editorContext, workspace.id);
    assert.ok(staleNormalized);
    staleNormalized!.items.find((item) => item.itemKey === "KEEP")!.name = "Stale overwrite";
    const staleImport = await stageNormalizedSupplySnapshot({
      officeId: office.id,
      workspaceId: workspace.id,
      createdByUserId: editor.id,
      sourceName: "Stale managed edit",
      adapter: "CUSTOMER_MANAGED",
      idempotencyNamespace: "customer-managed-stale-test",
      hash: normalizedSupplySourceHash(staleNormalized!),
      normalized: staleNormalized!,
    });
    await updateManagedSupplyItem(editorContext, workspace.id, "KEEP", {
      name: "Current unrelated part",
      description: "Must survive another item deletion",
      unitOfMeasure: "EA",
      requestedQuantity: 4,
      requestedUnit: "EA",
      deliveryLocation: "Austin receiving",
    });
    await assert.rejects(
      () => publishSupplyImport(editorContext, staleImport.id),
      /newer snapshot was published/i,
    );

    await deleteManagedSupplyItem(editorContext, workspace.id, "PART");
    loaded = await getSupplyWorkspace(editorContext, workspace.id);
    assert.equal(loaded.snapshots[0]?.version, 6);
    assert.deepEqual(loaded.snapshots[0]?.items.map((item) => item.itemKey).sort(), ["KEEP", "PRODUCT"]);
    assert.equal(loaded.snapshots[0]?.items.find((item) => item.itemKey === "KEEP")?.name, "Current unrelated part");
    assert.equal(loaded.snapshots[0]?.bomVersions[0]?.lines.length, 1);
    assert.equal(loaded.snapshots[0]?.inventory.length, 1);
    assert.equal(loaded.snapshots[0]?.demands.length, 2);
    assert.equal(loaded.snapshots[0]?.locations.some((location) => location.locationKey === CUSTOMER_BASE_LOCATION_KEY), true);
    const latestSnapshotId = loaded.snapshots[0]!.id;
    const survivingTerms = await prisma.supplySupplierTerm.findMany({
      where: { officeId: office.id, workspaceId: workspace.id, snapshotId: latestSnapshotId },
      select: { termKey: true },
    });
    assert.deepEqual(survivingTerms.map((term) => term.termKey), ["TERM-KEEP"]);
    const history = await prisma.supplySnapshot.findMany({
      where: { officeId: office.id, workspaceId: workspace.id, status: "PUBLISHED" },
      orderBy: { version: "asc" },
      include: { items: true },
    });
    assert.equal(history.length, 5);
    assert.equal(history[0]?.items.some((item) => item.itemKey === "PART"), true, "prior snapshots must retain removed items");

    console.log("Supply OS workspace management database test passed.");
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
