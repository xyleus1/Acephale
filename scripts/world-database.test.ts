import "dotenv/config";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getWorldPrisma } from "../src/lib/world/client";
import { loadSourceFile } from "../src/lib/world/load";
import { mergeSourceRecords } from "../src/lib/world/merge";
import { normalizeCompanyName } from "../src/lib/world/normalize";

async function main() {
  if (!process.env.WORLD_DATABASE_URL) {
    console.log("world database test skipped: WORLD_DATABASE_URL is unset");
    return;
  }

  const suffix = `world-test-${Date.now()}`;
  const ambiguousNameNormalized = normalizeCompanyName(`Ambiguous Widget ${suffix}`);
  const acmeName = `Acme Ltd ${suffix}`;
  const client = getWorldPrisma();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "derya-world-"));
  const gleifFile = path.join(tempDir, "gleif.csv");
  const ambiguousGleifFile = path.join(tempDir, "ambiguous-gleif.csv");
  const identifierCompanyFile = path.join(tempDir, "identifier-company.csv");
  const identifierGleifFile = path.join(tempDir, "identifier-gleif.csv");
  const batchIdentifierCompanyFile = path.join(tempDir, "batch-identifier-company.csv");
  const batchIdentifierGleifFile = path.join(tempDir, "batch-identifier-gleif.csv");
  const domainCompanyFile = path.join(tempDir, "domain-company.csv");
  const domainPdlFile = path.join(tempDir, "domain-pdl.csv");
  const domainFollowupPdlFile = path.join(tempDir, "domain-followup-pdl.csv");
  const manufacturerGleifFile = path.join(tempDir, "manufacturer-gleif.csv");
  const manufacturerCompanyFile = path.join(tempDir, "manufacturer-company.csv");
  const epaFacilitiesFile = path.join(tempDir, "epa-facilities.csv");
  const eeaFacilitiesFile = path.join(tempDir, "eea-facilities.csv");
  const companiesFile = path.join(tempDir, "companies.csv");
  const pdlFile = path.join(tempDir, "pdl.csv");
  const pdlJsonlFile = path.join(tempDir, "pdl.jsonl");
  const loadRunIds: string[] = [];
  let preexistingFacilityId: string | null = null;

  try {
    await writeFile(gleifFile, [
    "LEI,Entity.LegalName,Entity.LegalAddress.FirstAddressLine,Entity.LegalAddress.City,Entity.LegalAddress.Region,Entity.LegalAddress.Country,Entity.LegalAddress.PostalCode,Entity.EntityStatus,Registration.RegistrationStatus",
    `549300${suffix},Overlap Machinery ${suffix},Factory 1,Leeds,West Yorkshire,GB,LS1,ACTIVE,ISSUED`,
    ].join("\n"));
    await writeFile(companiesFile, [
    "CompanyName,CompanyNumber,RegAddress.AddressLine1,RegAddress.PostTown,RegAddress.County,RegAddress.PostCode,RegAddress.Country,CompanyStatus,CountryOfOrigin,IncorporationDate,SICCode.SicText_1,URI",
    `Shared Domain ${suffix} Ltd,${suffix}1,Factory Road,Leeds,West Yorkshire,LS1,United Kingdom,Active,United Kingdom,01/02/2001,25620 - Machining,`,
    `Name Match ${suffix} Ltd,${suffix}2,Factory Road,Leeds,West Yorkshire,LS2,United Kingdom,Active,United Kingdom,01/02/2002,62012 - Software,`,
    ].join("\n"));
    await writeFile(pdlFile, [
    "id,name,website,founded,size,locality,region,country,industry,linkedin_url",
    `${suffix}-pdl-domain,Shared Domain ${suffix} Limited,https://${suffix}.test,2000,51-200,Leeds,West Yorkshire,United Kingdom,machinery,`,
    `${suffix}-pdl-name,Name Match ${suffix} Limited,,2000,11-50,Leeds,West Yorkshire,United Kingdom,banking,`,
    ].join("\n"));
    await writeFile(ambiguousGleifFile, [
    "LEI,Entity.LegalName,Entity.LegalAddress.FirstAddressLine,Entity.LegalAddress.City,Entity.LegalAddress.Region,Entity.LegalAddress.Country,Entity.LegalAddress.PostalCode,Entity.EntityStatus,Registration.RegistrationStatus",
    `549300${suffix}A,Ambiguous Widget ${suffix} Ltd,Factory 2,Leeds,West Yorkshire,GB,LS2,ACTIVE,ISSUED`,
    `549300${suffix}B,Ambiguous Widget ${suffix} Limited,Factory 3,Leeds,West Yorkshire,GB,LS3,ACTIVE,ISSUED`,
    ].join("\n"));
    await writeFile(pdlJsonlFile, JSON.stringify({
      id: `${suffix}-pdl-ambiguous`,
      name: `Ambiguous Widget ${suffix}`,
      founded: 1998,
      website: null,
      country: "GB",
    }) + "\n");
    await writeFile(identifierCompanyFile, [
      "CompanyName,CompanyNumber,RegAddress.AddressLine1,RegAddress.PostTown,RegAddress.County,RegAddress.PostCode,RegAddress.Country,CompanyStatus,CountryOfOrigin,IncorporationDate,SICCode.SicText_1,URI",
      `Identifier Enrichment ${suffix} Ltd,${suffix}3,Factory 4,Leeds,West Yorkshire,LS4,United Kingdom,Active,United Kingdom,01/02/2003,25620 - Machining,`,
    ].join("\n"));
    await writeFile(identifierGleifFile, [
      "LEI,Entity.LegalName,Entity.LegalAddress.FirstAddressLine,Entity.LegalAddress.City,Entity.LegalAddress.Region,Entity.LegalAddress.Country,Entity.LegalAddress.PostalCode,Entity.EntityStatus,Registration.RegistrationStatus",
      `549300${suffix}C,Identifier Enrichment ${suffix} Limited,Factory 4,Leeds,West Yorkshire,GB,LS4,ACTIVE,ISSUED`,
    ].join("\n"));
    await writeFile(batchIdentifierCompanyFile, [
      "CompanyName,CompanyNumber,RegAddress.AddressLine1,RegAddress.PostTown,RegAddress.County,RegAddress.PostCode,RegAddress.Country,CompanyStatus,CountryOfOrigin,IncorporationDate,SICCode.SicText_1,URI",
      `Batch Identifier ${suffix} Ltd,${suffix}4,Factory 5,Leeds,West Yorkshire,LS5,United Kingdom,Active,United Kingdom,01/02/2004,25620 - Machining,`,
    ].join("\n"));
    await writeFile(batchIdentifierGleifFile, [
      "LEI,Entity.LegalName,Entity.LegalAddress.FirstAddressLine,Entity.LegalAddress.City,Entity.LegalAddress.Region,Entity.LegalAddress.Country,Entity.LegalAddress.PostalCode,Entity.EntityStatus,Registration.RegistrationStatus",
      `549300${suffix}D,Batch Identifier ${suffix} Limited,Factory 5,Leeds,West Yorkshire,GB,LS5,ACTIVE,ISSUED`,
    ].join("\n"));
    await writeFile(domainCompanyFile, [
      "CompanyName,CompanyNumber,RegAddress.AddressLine1,RegAddress.PostTown,RegAddress.County,RegAddress.PostCode,RegAddress.Country,CompanyStatus,CountryOfOrigin,IncorporationDate,SICCode.SicText_1,URI",
      `Domain Enrichment ${suffix} Ltd,${suffix}5,Factory 6,Leeds,West Yorkshire,LS6,United Kingdom,Active,United Kingdom,01/02/2005,25620 - Machining,`,
    ].join("\n"));
    await writeFile(domainPdlFile, [
      "id,name,website,founded,size,locality,region,country,industry,linkedin_url",
      `${suffix}-pdl-domain-enrichment,Domain Enrichment ${suffix} Limited,https://enrichment-${suffix}.test,2000,51-200,Leeds,West Yorkshire,United Kingdom,machinery,`,
    ].join("\n"));
    await writeFile(domainFollowupPdlFile, [
      "id,name,website,founded,size,locality,region,country,industry,linkedin_url",
      `${suffix}-pdl-domain-followup,Domain Followup ${suffix},https://enrichment-${suffix}.test,2001,11-50,Leeds,West Yorkshire,United Kingdom,banking,`,
    ].join("\n"));
    await writeFile(manufacturerGleifFile, [
      "LEI,Entity.LegalName,Entity.LegalAddress.FirstAddressLine,Entity.LegalAddress.City,Entity.LegalAddress.Region,Entity.LegalAddress.Country,Entity.LegalAddress.PostalCode,Entity.EntityStatus,Registration.RegistrationStatus",
      `549300${suffix}E,Manufacturer Enrichment ${suffix} Limited,Factory 7,Leeds,West Yorkshire,GB,LS7,ACTIVE,ISSUED`,
    ].join("\n"));
    await writeFile(manufacturerCompanyFile, [
      "CompanyName,CompanyNumber,RegAddress.AddressLine1,RegAddress.PostTown,RegAddress.County,RegAddress.PostCode,RegAddress.Country,CompanyStatus,CountryOfOrigin,IncorporationDate,SICCode.SicText_1,URI",
      `Manufacturer Enrichment ${suffix} Ltd,${suffix}6,Factory 7,Leeds,West Yorkshire,LS7,United Kingdom,Active,United Kingdom,01/02/2006,25620 - Machining,`,
    ].join("\n"));
    await writeFile(epaFacilitiesFile, [
      "REGISTRY_ID,PRIMARY_NAME,LOCATION_ADDRESS,CITY_NAME,STATE_CODE,POSTAL_CODE,NAICS_CODES,SIC_CODES",
      `${suffix}-epa-1,Private Residence,1 Main Street,Denver,CO,80202,531120,6512`,
      `${suffix}-epa-2,Private Residence,2 Main Street,Denver,CO,80202,531120,6512`,
    ].join("\n"));
    await writeFile(eeaFacilitiesFile, [
      "FacilityInspireId,facilityName,countryName,city,reportingYear,EPRTRAnnexIMainActivity,EPRTR_SectorName,Pollutant",
      `${suffix}-eea-facility,Old Facility,Germany,Berlin,2022,4(a),Chemical industry,Ammonia`,
      `${suffix}-eea-facility,Latest Facility,Germany,Berlin,2024,4(b),Chemical industry,Carbon dioxide`,
      `${suffix}-eea-facility,Middle Facility,Germany,Berlin,2023,4(c),Chemical industry,Nitrogen oxides`,
    ].join("\n"));

    const gleifRun = await loadSourceFile({ client, source: "gleif", filePath: gleifFile, batchSize: 1 });
    loadRunIds.push(gleifRun.id);
    const rerun = await loadSourceFile({ client, source: "gleif", filePath: gleifFile, batchSize: 1 });
    loadRunIds.push(rerun.id);
    assert.equal(rerun.rowsInserted, 0);
    const companiesRun = await loadSourceFile({ client, source: "companies_house", filePath: companiesFile, batchSize: 2 });
    loadRunIds.push(companiesRun.id);
    const pdlRun = await loadSourceFile({ client, source: "pdl_free", filePath: pdlFile, batchSize: 2 });
    loadRunIds.push(pdlRun.id);
    await client.worldSourceRecord.update({
      where: { source_sourceRecordId: { source: "companies_house", sourceRecordId: `${suffix}1` } },
      data: { domain: `${suffix}.test` },
    });
    const counters = await mergeSourceRecords({ client, batchSize: 10 });
    assert.equal(counters.inserted, 3);
    assert.ok(counters.matchedByDomain >= 1);
    assert.equal(counters.leftBehind, 0);
    const companies = await client.worldCompany.findMany({
      where: { canonicalName: { contains: suffix } },
      orderBy: { canonicalName: "asc" },
    });
    assert.equal(companies.length, 3);
    const shared = companies.find((company) => company.domain === `${suffix}.test`);
    assert.ok(shared?.isManufacturer);
    assert.equal(shared?.sourceCount, 2);
    assert.deepEqual(shared?.legalIds, { companies_house: `${suffix}1`, pdl_id: `${suffix}-pdl-domain` });
    const nameMatch = companies.find((company) => company.canonicalName.startsWith(`Name Match ${suffix}`));
    assert.equal(nameMatch?.sourceCount, 2);
    const records = await client.worldSourceRecord.findMany({
      where: { sourceRecordId: { contains: suffix } },
    });
    assert.equal(records.length, 5);
    assert.ok(records.every((record) => record.merged && record.companyId));
    const ambiguousGleifRun = await loadSourceFile({
      client,
      source: "gleif",
      filePath: ambiguousGleifFile,
      batchSize: 2,
    });
    loadRunIds.push(ambiguousGleifRun.id);
    await mergeSourceRecords({ client, batchSize: 10 });
    const ambiguousCompanies = await client.worldCompany.findMany({
      where: { nameNormalized: ambiguousNameNormalized },
      orderBy: { id: "asc" },
    });
    assert.equal(ambiguousCompanies.length, 2);
    assert.ok(ambiguousCompanies.every((company) => company.sourceCount === 1));
    const pdlJsonRun = await loadSourceFile({
      client,
      source: "pdl_free",
      filePath: pdlJsonlFile,
      batchSize: 1,
    });
    loadRunIds.push(pdlJsonRun.id);
    assert.equal(pdlJsonRun.rowsInserted, 1);
    const numericPdlRecord = await client.worldSourceRecord.findUnique({
      where: {
        source_sourceRecordId: {
          source: "pdl_free",
          sourceRecordId: `${suffix}-pdl-ambiguous`,
        },
      },
    });
    assert.equal(numericPdlRecord?.foundedYear, 1998);
    assert.equal(numericPdlRecord?.website, null);
    await mergeSourceRecords({ client, batchSize: 10 });
    const allAmbiguousCompanies = await client.worldCompany.findMany({
      where: { nameNormalized: ambiguousNameNormalized },
    });
    assert.equal(allAmbiguousCompanies.length, 3);
    assert.equal(allAmbiguousCompanies.filter((company) => company.sourceCount === 1).length, 3);
    const identifierCompanyRun = await loadSourceFile({
      client,
      source: "companies_house",
      filePath: identifierCompanyFile,
      batchSize: 1,
    });
    loadRunIds.push(identifierCompanyRun.id);
    await mergeSourceRecords({ client, batchSize: 10 });
    const identifierGleifRun = await loadSourceFile({
      client,
      source: "gleif",
      filePath: identifierGleifFile,
      batchSize: 1,
    });
    loadRunIds.push(identifierGleifRun.id);
    await mergeSourceRecords({ client, batchSize: 10 });
    const identifierCompanies = await client.worldCompany.findMany({
      where: { nameNormalized: normalizeCompanyName(`Identifier Enrichment ${suffix}`) },
    });
    assert.equal(identifierCompanies.length, 1);
    assert.equal(identifierCompanies[0]?.lei, `549300${suffix}C`);
    assert.equal(identifierCompanies[0]?.sourceCount, 2);
    const batchCompanyRun = await loadSourceFile({
      client,
      source: "companies_house",
      filePath: batchIdentifierCompanyFile,
      batchSize: 1,
    });
    loadRunIds.push(batchCompanyRun.id);
    const batchGleifRun = await loadSourceFile({
      client,
      source: "gleif",
      filePath: batchIdentifierGleifFile,
      batchSize: 1,
    });
    loadRunIds.push(batchGleifRun.id);
    await mergeSourceRecords({ client, batchSize: 10 });
    const batchIdentifierCompanies = await client.worldCompany.findMany({
      where: { nameNormalized: normalizeCompanyName(`Batch Identifier ${suffix}`) },
    });
    assert.equal(batchIdentifierCompanies.length, 1);
    assert.equal(batchIdentifierCompanies[0]?.lei, `549300${suffix}D`);
    assert.equal(batchIdentifierCompanies[0]?.sourceCount, 2);
    const domainCompanyRun = await loadSourceFile({
      client,
      source: "companies_house",
      filePath: domainCompanyFile,
      batchSize: 1,
    });
    loadRunIds.push(domainCompanyRun.id);
    await mergeSourceRecords({ client, batchSize: 10 });
    const domainPdlRun = await loadSourceFile({
      client,
      source: "pdl_free",
      filePath: domainPdlFile,
      batchSize: 1,
    });
    loadRunIds.push(domainPdlRun.id);
    await mergeSourceRecords({ client, batchSize: 10 });
    const domainFollowupRun = await loadSourceFile({
      client,
      source: "pdl_free",
      filePath: domainFollowupPdlFile,
      batchSize: 1,
    });
    loadRunIds.push(domainFollowupRun.id);
    await mergeSourceRecords({ client, batchSize: 10 });
    const domainCompanies = await client.worldCompany.findMany({
      where: { nameNormalized: normalizeCompanyName(`Domain Enrichment ${suffix}`) },
    });
    assert.equal(domainCompanies.length, 1);
    assert.equal(domainCompanies[0]?.domain, `enrichment-${suffix}.test`);
    assert.equal(domainCompanies[0]?.sourceCount, 3);
    const manufacturerGleifRun = await loadSourceFile({
      client,
      source: "gleif",
      filePath: manufacturerGleifFile,
      batchSize: 1,
    });
    loadRunIds.push(manufacturerGleifRun.id);
    await mergeSourceRecords({ client, batchSize: 10 });
    const manufacturerCompanyRun = await loadSourceFile({
      client,
      source: "companies_house",
      filePath: manufacturerCompanyFile,
      batchSize: 1,
    });
    loadRunIds.push(manufacturerCompanyRun.id);
    await mergeSourceRecords({ client, batchSize: 10 });
    const manufacturerCompanies = await client.worldCompany.findMany({
      where: { nameNormalized: normalizeCompanyName(`Manufacturer Enrichment ${suffix}`) },
    });
    assert.equal(manufacturerCompanies.length, 1);
    assert.deepEqual(manufacturerCompanies[0]?.industryCodes, { uk_sic: ["25620"] });
    assert.equal(Array.isArray(manufacturerCompanies[0]?.manufacturerEvidence), true);
    assert.equal((manufacturerCompanies[0]?.manufacturerEvidence as unknown[]).length, 1);
    assert.equal(manufacturerCompanies[0]?.isManufacturer, true);

    const siblingName = `Name Sibling ${suffix}`;
    const siblingNormalized = normalizeCompanyName(siblingName);
    const siblingRun = await client.worldLoadRun.create({
      data: { source: "name_sibling_test", fileName: "name-sibling-fixture.csv" },
    });
    loadRunIds.push(siblingRun.id);
    await client.worldSourceRecord.createMany({
      data: ["a", "b"].map((id) => ({
        id: `${suffix}-name-sibling-${id}`,
        source: "name_sibling_test",
        sourceRecordId: `${suffix}-name-sibling-${id}`,
        loadRunId: siblingRun.id,
        name: siblingName,
        nameNormalized: siblingNormalized,
        country: "GB",
        payload: {},
      })),
    });
    const siblingCounters = await mergeSourceRecords({
      client,
      batchSize: 2,
      source: "name_sibling_test",
    });
    assert.equal(siblingCounters.inserted, 1);
    assert.equal(siblingCounters.matchedByName, 1);
    assert.equal(siblingCounters.leftBehind, 0);
    assert.equal(
      await client.worldCompany.count({ where: { nameNormalized: siblingNormalized } }),
      1,
    );
    assert.equal(
      await client.worldSourceRecord.count({
        where: { source: "name_sibling_test", merged: true },
      }),
      2,
    );

    const windowHookRun = await client.worldLoadRun.create({
      data: { source: "window_hook_test", fileName: "window-hook-fixture.csv" },
    });
    loadRunIds.push(windowHookRun.id);
    await client.worldSourceRecord.createMany({
      data: ["w1", "w3", "w5"].map((id) => ({
        id,
        source: "window_hook_test",
        sourceRecordId: `${suffix}-window-hook-${id}`,
        loadRunId: windowHookRun.id,
        name: `Window Hook ${id} ${suffix}`,
        nameNormalized: normalizeCompanyName(`Window Hook ${id} ${suffix}`),
        country: "GB",
        payload: {},
      })),
    });
    let windowHookInserted = false;
    const windowHookCounters = await mergeSourceRecords({
      client,
      batchSize: 2,
      source: "window_hook_test",
      onWindowSelected: async ({ firstId }) => {
        if (windowHookInserted || firstId !== "w1") return;
        windowHookInserted = true;
        await client.worldSourceRecord.create({
          data: {
            id: "w2",
            source: "window_hook_test",
            sourceRecordId: `${suffix}-window-hook-w2`,
            loadRunId: windowHookRun.id,
            name: `Window Hook w2 ${suffix}`,
            nameNormalized: normalizeCompanyName(`Window Hook w2 ${suffix}`),
            country: "GB",
            payload: {},
          },
        });
      },
    });
    assert.equal(windowHookCounters.leftBehind, 0);
    assert.equal(
      await client.worldSourceRecord.count({
        where: { source: "window_hook_test", merged: true },
      }),
      4,
    );
    assert.equal(
      await client.worldCompany.count({
        where: {
          canonicalName: { startsWith: "Window Hook", contains: suffix },
        },
      }),
      4,
    );
    await client.worldSourceRecord.deleteMany({ where: { source: "window_hook_test" } });

    const finalSweepRun = await client.worldLoadRun.create({
      data: { source: "final_sweep_test", fileName: "final-sweep-fixture.csv" },
    });
    loadRunIds.push(finalSweepRun.id);
    await client.worldSourceRecord.createMany({
      data: ["x2", "x4", "x6"].map((id) => ({
        id: `final-sweep-${id}`,
        source: "final_sweep_test",
        sourceRecordId: `${suffix}-final-sweep-${id}`,
        loadRunId: finalSweepRun.id,
        name: `Final Sweep ${id} ${suffix}`,
        nameNormalized: normalizeCompanyName(`Final Sweep ${id} ${suffix}`),
        country: "GB",
        payload: {},
      })),
    });
    let finalSweepInserted = false;
    let secondSweepInserted = false;
    const finalSweepCounters = await mergeSourceRecords({
      client,
      batchSize: 2,
      source: "final_sweep_test",
      onWindowSelected: async ({ firstId }) => {
        if (!finalSweepInserted && firstId === "final-sweep-x6") {
          finalSweepInserted = true;
          await client.worldSourceRecord.createMany({
            data: ["a1", "a2", "a3"].map((id) => ({
              id: `final-sweep-${id}`,
              source: "final_sweep_test",
              sourceRecordId: `${suffix}-final-sweep-${id}`,
              loadRunId: finalSweepRun.id,
              name: `Final Sweep ${id} ${suffix}`,
              nameNormalized: normalizeCompanyName(`Final Sweep ${id} ${suffix}`),
              country: "GB",
              payload: {},
            })),
          });
        } else if (!secondSweepInserted && firstId === "final-sweep-a3") {
          secondSweepInserted = true;
          await client.worldSourceRecord.create({
            data: {
              id: "final-sweep-a0",
              source: "final_sweep_test",
              sourceRecordId: `${suffix}-final-sweep-a0`,
              loadRunId: finalSweepRun.id,
              name: `Final Sweep a0 ${suffix}`,
              nameNormalized: normalizeCompanyName(`Final Sweep a0 ${suffix}`),
              country: "GB",
              payload: {},
            },
          });
        }
      },
    });
    assert.equal(finalSweepCounters.leftBehind, 1);
    assert.equal(
      await client.worldSourceRecord.count({
        where: { source: "final_sweep_test", merged: true },
      }),
      6,
    );
    const finalSweepRetryCounters = await mergeSourceRecords({
      client,
      batchSize: 2,
      source: "final_sweep_test",
    });
    assert.equal(finalSweepRetryCounters.leftBehind, 0);
    assert.equal(
      await client.worldCompany.count({
        where: {
          canonicalName: { startsWith: "Final Sweep", contains: suffix },
        },
      }),
      7,
    );

    const afterInsertHookRun = await client.worldLoadRun.create({
      data: { source: "after_insert_hook_test", fileName: "after-insert-hook-fixture.csv" },
    });
    loadRunIds.push(afterInsertHookRun.id);
    await client.worldSourceRecord.createMany({
      data: ["w1", "w3"].map((id) => ({
        id,
        source: "after_insert_hook_test",
        sourceRecordId: `${suffix}-after-insert-hook-${id}`,
        loadRunId: afterInsertHookRun.id,
        name: `After Insert Hook ${id} ${suffix}`,
        nameNormalized: normalizeCompanyName(`After Insert Hook ${id} ${suffix}`),
        country: "GB",
        payload: {},
      })),
    });
    let afterInsertHookInserted = false;
    const afterInsertHookCounters = await mergeSourceRecords({
      client,
      batchSize: 2,
      source: "after_insert_hook_test",
      onBeforeLeftBehindCount: async ({ firstId }) => {
        if (afterInsertHookInserted || firstId !== "w1") return;
        afterInsertHookInserted = true;
        await client.worldSourceRecord.create({
          data: {
            id: "w2",
            source: "after_insert_hook_test",
            sourceRecordId: `${suffix}-after-insert-hook-w2`,
            loadRunId: afterInsertHookRun.id,
            name: `After Insert Hook w2 ${suffix}`,
            nameNormalized: normalizeCompanyName(`After Insert Hook w2 ${suffix}`),
            country: "GB",
            payload: {},
          },
        });
      },
    });
    assert.equal(afterInsertHookCounters.leftBehind, 0);
    assert.equal(
      await client.worldSourceRecord.count({
        where: { source: "after_insert_hook_test", merged: true },
      }),
      3,
    );

    const epaRun = await loadSourceFile({
      client,
      source: "epa_frs",
      filePath: epaFacilitiesFile,
      batchSize: 2,
    });
    loadRunIds.push(epaRun.id);
    const preexistingFacility = await client.worldCompany.create({
      data: {
        canonicalName: acmeName,
        nameNormalized: normalizeCompanyName(acmeName),
        nameMatchable: false,
        country: "GB",
        sourceCount: 1,
      },
    });
    preexistingFacilityId = preexistingFacility.id;
    const acmeCompanyFile = path.join(tempDir, "acme-company.csv");
    await writeFile(acmeCompanyFile, [
      "CompanyName,CompanyNumber,RegAddress.PostTown,RegAddress.Country",
      `${acmeName},${suffix}-acme,London,United Kingdom`,
    ].join("\n"));
    const acmeRun = await loadSourceFile({
      client,
      source: "companies_house",
      filePath: acmeCompanyFile,
      batchSize: 1,
    });
    loadRunIds.push(acmeRun.id);
    const eeaRun = await loadSourceFile({
      client,
      source: "eu_industrial_emissions",
      filePath: eeaFacilitiesFile,
      batchSize: 2,
    });
    loadRunIds.push(eeaRun.id);
    assert.equal(eeaRun.rowsRead, 3);
    assert.equal(eeaRun.rowsInserted, 1);
    await mergeSourceRecords({ client, batchSize: 10 });
    const epaRecords = await client.worldSourceRecord.findMany({
      where: { source: "epa_frs", sourceRecordId: { contains: suffix } },
    });
    assert.equal(epaRecords.length, 2);
    assert.notEqual(epaRecords[0]?.companyId, epaRecords[1]?.companyId);
    assert.ok(epaRecords.every((record) => record.nameMatchable === false));
    const acmeCompanies = await client.worldCompany.findMany({
      where: {
        country: "GB",
        nameNormalized: normalizeCompanyName(acmeName),
      },
    });
    assert.equal(acmeCompanies.length, 2);
    const eeaRecord = await client.worldSourceRecord.findUnique({
      where: {
        source_sourceRecordId: {
          source: "eu_industrial_emissions",
          sourceRecordId: `${suffix}-eea-facility`,
        },
      },
    });
    assert.equal(eeaRecord?.name, "Latest Facility");
    assert.equal(eeaRecord?.nameMatchable, false);
    const eeaPayload = eeaRecord?.payload as {
      rowCount?: number;
      reportingYears?: string[];
      latest?: { facilityName?: string };
    };
    assert.equal(eeaPayload.rowCount, 3);
    assert.deepEqual(eeaPayload.reportingYears, ["2022", "2023", "2024"]);
    assert.equal(eeaPayload.latest?.facilityName, "Latest Facility");

    const crossWindowNameOne = `Cross Window One ${suffix}`;
    const crossWindowNormalizedOne = normalizeCompanyName(crossWindowNameOne);
    const crossWindowBatchOneRun = await client.worldLoadRun.create({
      data: { source: "cross_window_batch_one", fileName: "cross-window-one.csv" },
    });
    loadRunIds.push(crossWindowBatchOneRun.id);
    await client.worldSourceRecord.createMany({
      data: [
        {
          id: `${suffix}-cross-window-one-a`,
          source: "cross_window_batch_one",
          sourceRecordId: `${suffix}-cross-window-one-a`,
          loadRunId: crossWindowBatchOneRun.id,
          name: crossWindowNameOne,
          nameNormalized: crossWindowNormalizedOne,
          country: "GB",
          lei: `${suffix}-cross-window-lei-a`,
          payload: {},
        },
        {
          id: `${suffix}-cross-window-one-b`,
          source: "cross_window_batch_one",
          sourceRecordId: `${suffix}-cross-window-one-b`,
          loadRunId: crossWindowBatchOneRun.id,
          name: crossWindowNameOne,
          nameNormalized: crossWindowNormalizedOne,
          country: "GB",
          lei: `${suffix}-cross-window-lei-c`,
          payload: {},
        },
        {
          id: `${suffix}-cross-window-one-c`,
          source: "cross_window_batch_one",
          sourceRecordId: `${suffix}-cross-window-one-c`,
          loadRunId: crossWindowBatchOneRun.id,
          name: crossWindowNameOne,
          nameNormalized: crossWindowNormalizedOne,
          country: "GB",
          payload: {},
        },
      ],
    });
    const crossWindowOneCounters = await mergeSourceRecords({
      client,
      batchSize: 1,
      source: "cross_window_batch_one",
    });
    const crossWindowOneCompanies = await client.worldCompany.findMany({
      where: { nameNormalized: crossWindowNormalizedOne },
    });
    const crossWindowOneRecords = await client.worldSourceRecord.findMany({
      where: { source: "cross_window_batch_one" },
      orderBy: { sourceRecordId: "asc" },
    });
    assert.equal(crossWindowOneCounters.leftBehind, 0);
    assert.equal(crossWindowOneCompanies.length, 3);
    assert.deepEqual(
      crossWindowOneCompanies.map((company) => company.lei).filter(Boolean).sort(),
      [`${suffix}-cross-window-lei-a`, `${suffix}-cross-window-lei-c`],
    );
    assert.ok(crossWindowOneRecords[2]?.companyId);
    assert.notEqual(crossWindowOneRecords[2]?.companyId, crossWindowOneRecords[0]?.companyId);
    const crossWindowOneNameCompany = crossWindowOneCompanies.find(
      (company) => company.id === crossWindowOneRecords[2]?.companyId,
    );
    assert.equal(crossWindowOneNameCompany?.lei, null);

    const crossWindowNameThree = `Cross Window Three ${suffix}`;
    const crossWindowNormalizedThree = normalizeCompanyName(crossWindowNameThree);
    const crossWindowBatchThreeRun = await client.worldLoadRun.create({
      data: { source: "cross_window_batch_three", fileName: "cross-window-three.csv" },
    });
    loadRunIds.push(crossWindowBatchThreeRun.id);
    await client.worldSourceRecord.createMany({
      data: [
        {
          id: `${suffix}-cross-window-three-a`,
          source: "cross_window_batch_three",
          sourceRecordId: `${suffix}-cross-window-three-a`,
          loadRunId: crossWindowBatchThreeRun.id,
          name: crossWindowNameThree,
          nameNormalized: crossWindowNormalizedThree,
          country: "GB",
          lei: `${suffix}-cross-window-three-lei-a`,
          payload: {},
        },
        {
          id: `${suffix}-cross-window-three-b`,
          source: "cross_window_batch_three",
          sourceRecordId: `${suffix}-cross-window-three-b`,
          loadRunId: crossWindowBatchThreeRun.id,
          name: crossWindowNameThree,
          nameNormalized: crossWindowNormalizedThree,
          country: "GB",
          lei: `${suffix}-cross-window-three-lei-c`,
          payload: {},
        },
        {
          id: `${suffix}-cross-window-three-c`,
          source: "cross_window_batch_three",
          sourceRecordId: `${suffix}-cross-window-three-c`,
          loadRunId: crossWindowBatchThreeRun.id,
          name: crossWindowNameThree,
          nameNormalized: crossWindowNormalizedThree,
          country: "GB",
          payload: {},
        },
      ],
    });
    const crossWindowThreeCounters = await mergeSourceRecords({
      client,
      batchSize: 3,
      source: "cross_window_batch_three",
    });
    const crossWindowThreeCompanies = await client.worldCompany.findMany({
      where: { nameNormalized: crossWindowNormalizedThree },
      orderBy: { id: "asc" },
    });
    const crossWindowThreeRecords = await client.worldSourceRecord.findMany({
      where: { source: "cross_window_batch_three" },
      orderBy: { sourceRecordId: "asc" },
    });
    assert.equal(crossWindowThreeCounters.leftBehind, 0);
    assert.equal(crossWindowThreeCompanies.length, 3);
    assert.deepEqual(
      crossWindowThreeCompanies.map((company) => company.lei).filter(Boolean).sort(),
      [`${suffix}-cross-window-three-lei-a`, `${suffix}-cross-window-three-lei-c`],
    );
    assert.ok(crossWindowThreeRecords[2]?.companyId);
    assert.notEqual(crossWindowThreeRecords[2]?.companyId, crossWindowThreeRecords[0]?.companyId);
    const crossWindowThreeNameCompany = crossWindowThreeCompanies.find(
      (company) => company.id === crossWindowThreeRecords[2]?.companyId,
    );
    assert.equal(crossWindowThreeNameCompany?.lei, null);

    for (const [source, batchSize] of [
      ["identifier_conflict_one", 1],
      ["identifier_conflict_three", 3],
    ] as const) {
      const identifierConflictName = `Identifier Conflict ${source} ${suffix}`;
      const identifierConflictNormalized = normalizeCompanyName(identifierConflictName);
      const run = await client.worldLoadRun.create({
        data: { source, fileName: `${source}.csv` },
      });
      loadRunIds.push(run.id);
      const existingCompany = await client.worldCompany.create({
        data: {
          canonicalName: identifierConflictName,
          nameNormalized: identifierConflictNormalized,
          country: "GB",
          nameMatchable: true,
        },
      });
      await client.worldSourceRecord.createMany({
        data: [
          {
            id: `${suffix}-${source}-b`,
            source,
            sourceRecordId: `${suffix}-${source}-b`,
            loadRunId: run.id,
            name: identifierConflictName,
            nameNormalized: identifierConflictNormalized,
            country: "GB",
            lei: `${suffix}-${source}-lei-a`,
            payload: {},
          },
          {
            id: `${suffix}-${source}-c`,
            source,
            sourceRecordId: `${suffix}-${source}-c`,
            loadRunId: run.id,
            name: identifierConflictName,
            nameNormalized: identifierConflictNormalized,
            country: "GB",
            lei: `${suffix}-${source}-lei-b`,
            payload: {},
          },
          {
            id: `${suffix}-${source}-a`,
            source,
            sourceRecordId: `${suffix}-${source}-a`,
            loadRunId: run.id,
            name: identifierConflictName,
            nameNormalized: identifierConflictNormalized,
            country: "GB",
            payload: {},
          },
        ],
      });
      const result = await mergeSourceRecords({ client, batchSize, source });
      const companies = await client.worldCompany.findMany({
        where: { nameNormalized: identifierConflictNormalized },
      });
      const records = await client.worldSourceRecord.findMany({
        where: { source },
        orderBy: { sourceRecordId: "asc" },
      });
      const refreshedExistingCompany = await client.worldCompany.findUnique({
        where: { id: existingCompany.id },
      });
      assert.equal(result.leftBehind, 0);
      assert.equal(companies.length, 3);
      assert.equal(refreshedExistingCompany?.lei, null);
      assert.equal(refreshedExistingCompany?.sourceCount, 1);
      assert.deepEqual(
        companies.map((company) => company.lei).filter(Boolean).sort(),
        [`${suffix}-${source}-lei-a`, `${suffix}-${source}-lei-b`],
      );
      assert.equal(records.length, 3);
      assert.ok(records.every((record) => record.merged && record.companyId));
      const nameOnlyRecord = records.find((record) => record.sourceRecordId.endsWith("-a"));
      assert.equal(nameOnlyRecord?.companyId, refreshedExistingCompany?.id);
    }

    for (const [source, batchSize] of [
      ["domain_conflict_one", 1],
      ["domain_conflict_three", 3],
    ] as const) {
      const domainConflictName = `Domain Conflict ${source} ${suffix}`;
      const domainConflictNormalized = normalizeCompanyName(domainConflictName);
      const run = await client.worldLoadRun.create({
        data: { source, fileName: `${source}.csv` },
      });
      loadRunIds.push(run.id);
      const existingCompany = await client.worldCompany.create({
        data: {
          canonicalName: domainConflictName,
          nameNormalized: domainConflictNormalized,
          country: "GB",
          nameMatchable: true,
        },
      });
      await client.worldSourceRecord.createMany({
        data: [
          {
            id: `${suffix}-${source}-b`,
            source,
            sourceRecordId: `${suffix}-${source}-b`,
            loadRunId: run.id,
            name: domainConflictName,
            nameNormalized: domainConflictNormalized,
            country: "GB",
            domain: `${source}-${suffix}-a.test`,
            payload: {},
          },
          {
            id: `${suffix}-${source}-c`,
            source,
            sourceRecordId: `${suffix}-${source}-c`,
            loadRunId: run.id,
            name: domainConflictName,
            nameNormalized: domainConflictNormalized,
            country: "GB",
            domain: `${source}-${suffix}-b.test`,
            payload: {},
          },
          {
            id: `${suffix}-${source}-a`,
            source,
            sourceRecordId: `${suffix}-${source}-a`,
            loadRunId: run.id,
            name: domainConflictName,
            nameNormalized: domainConflictNormalized,
            country: "GB",
            payload: {},
          },
        ],
      });
      const result = await mergeSourceRecords({ client, batchSize, source });
      const companies = await client.worldCompany.findMany({
        where: { nameNormalized: domainConflictNormalized },
      });
      const records = await client.worldSourceRecord.findMany({
        where: { source },
        orderBy: { sourceRecordId: "asc" },
      });
      const refreshedExistingCompany = await client.worldCompany.findUnique({
        where: { id: existingCompany.id },
      });
      assert.equal(result.leftBehind, 0);
      assert.equal(companies.length, 3);
      assert.equal(refreshedExistingCompany?.domain, null);
      assert.equal(refreshedExistingCompany?.sourceCount, 1);
      assert.deepEqual(
        companies.map((company) => company.domain).filter(Boolean).sort(),
        [`${source}-${suffix}-a.test`, `${source}-${suffix}-b.test`],
      );
      assert.equal(records.length, 3);
      assert.ok(records.every((record) => record.merged && record.companyId));
      const nameOnlyRecord = records.find((record) => record.sourceRecordId.endsWith("-a"));
      assert.equal(nameOnlyRecord?.companyId, refreshedExistingCompany?.id);
    }

    for (const [source, batchSize] of [
      ["domain_sibling_one", 1],
      ["domain_sibling_three", 3],
    ] as const) {
      const name = `Domain Sibling ${source} ${suffix}`;
      const normalized = normalizeCompanyName(name);
      const run = await client.worldLoadRun.create({
        data: { source, fileName: `${source}.csv` },
      });
      loadRunIds.push(run.id);
      await client.worldSourceRecord.createMany({
        data: [
          {
            id: `${suffix}-${source}-c`,
            source,
            sourceRecordId: `${suffix}-${source}-c`,
            loadRunId: run.id,
            name,
            nameNormalized: normalized,
            country: "GB",
            lei: `${suffix}-${source}-lei`,
            payload: {},
          },
          {
            id: `${suffix}-${source}-a`,
            source,
            sourceRecordId: `${suffix}-${source}-a`,
            loadRunId: run.id,
            name,
            nameNormalized: normalized,
            country: "GB",
            domain: `${source}-${suffix}-a.example`,
            payload: {},
          },
          {
            id: `${suffix}-${source}-b`,
            source,
            sourceRecordId: `${suffix}-${source}-b`,
            loadRunId: run.id,
            name,
            nameNormalized: normalized,
            country: "GB",
            domain: `${source}-${suffix}-b.example`,
            payload: {},
          },
        ],
      });
      const result = await mergeSourceRecords({ client, batchSize, source });
      const companies = await client.worldCompany.findMany({
        where: { nameNormalized: normalized },
      });
      const records = await client.worldSourceRecord.findMany({
        where: { source },
      });
      assert.equal(result.leftBehind, 0);
      assert.equal(records.length, 3);
      assert.ok(records.every((record) => record.merged && record.companyId));
      assert.equal(companies.length, 3);
      assert.equal(new Set(companies.map((company) => company.id)).size, 3);
      const leiCompany = companies.find((company) => company.lei === `${suffix}-${source}-lei`);
      assert.ok(leiCompany);
      assert.equal(leiCompany?.domain, null);
    }

    const applyIndustryName = `Apply Industry ${suffix}`;
    const applyIndustryCompany = await client.worldCompany.create({
      data: {
        canonicalName: applyIndustryName,
        nameNormalized: normalizeCompanyName(applyIndustryName),
        country: "GB",
        industryCodes: { uk_sic: ["10110"] },
      },
    });
    const applyIndustryRun = await client.worldLoadRun.create({
      data: { source: "apply_industry_test", fileName: "apply-industry.csv" },
    });
    loadRunIds.push(applyIndustryRun.id);
    await client.worldSourceRecord.create({
      data: {
        source: "apply_industry_test",
        sourceRecordId: `${suffix}-apply-industry`,
        loadRunId: applyIndustryRun.id,
        name: applyIndustryName,
        nameNormalized: normalizeCompanyName(applyIndustryName),
        country: "GB",
        industryCodes: { uk_sic: ["10120"] },
        payload: {},
      },
    });
    const applyIndustryCounters = await mergeSourceRecords({
      client,
      batchSize: 1,
      source: "apply_industry_test",
    });
    assert.equal(applyIndustryCounters.matchedByName, 1);
    const updatedApplyIndustryCompany = await client.worldCompany.findUnique({
      where: { id: applyIndustryCompany.id },
    });
    assert.deepEqual(updatedApplyIndustryCompany?.industryCodes, {
      uk_sic: ["10110", "10120"],
    });

    const deferralName = `Facility Deferral ${suffix}`;
    const deferralNormalized = normalizeCompanyName(deferralName);
    await client.worldCompany.create({
      data: {
        canonicalName: deferralName,
        nameNormalized: deferralNormalized,
        nameMatchable: false,
        country: "DE",
      },
    });
    const deferralRun = await client.worldLoadRun.create({
      data: { source: "facility_deferral_test", fileName: "facility-deferral.csv" },
    });
    loadRunIds.push(deferralRun.id);
    await client.worldSourceRecord.createMany({
      data: [
        {
          id: `${suffix}-facility-deferral-lei`,
          source: "facility_deferral_test",
          sourceRecordId: `${suffix}-facility-deferral-lei`,
          loadRunId: deferralRun.id,
          name: deferralName,
          nameNormalized: deferralNormalized,
          country: "DE",
          lei: `${suffix}-facility-deferral-lei`,
          payload: {},
        },
        {
          id: `${suffix}-facility-deferral-name`,
          source: "facility_deferral_test",
          sourceRecordId: `${suffix}-facility-deferral-name`,
          loadRunId: deferralRun.id,
          name: deferralName,
          nameNormalized: deferralNormalized,
          country: "DE",
          payload: {},
        },
      ],
    });
    const deferralCounters = await mergeSourceRecords({
      client,
      batchSize: 2,
      source: "facility_deferral_test",
    });
    const deferralCompanies = await client.worldCompany.findMany({
      where: { nameNormalized: deferralNormalized },
    });
    assert.equal(deferralCounters.leftBehind, 0);
    assert.equal(deferralCompanies.length, 2);
    assert.equal(deferralCompanies.filter((company) => company.nameMatchable).length, 1);
    const deferralRecords = await client.worldSourceRecord.findMany({
      where: { source: "facility_deferral_test" },
    });
    assert.equal(deferralRecords[0]?.companyId, deferralRecords[1]?.companyId);

    const cursorNamePrefix = `Cursor-${suffix}`;
    const cursorExistingName = `${cursorNamePrefix} Existing`;
    const cursorExisting = await client.worldCompany.create({
      data: {
        canonicalName: cursorExistingName,
        nameNormalized: normalizeCompanyName(cursorExistingName),
        domain: `cursor-${suffix}.test`,
        country: "GB",
      },
    });
    const cursorRun = await client.worldLoadRun.create({
      data: { source: "cursor_test", fileName: "cursor-fixture.csv" },
    });
    loadRunIds.push(cursorRun.id);
    const cursorRecords = [
      {
        id: `${suffix}-cursor-3`,
        sourceRecordId: `${suffix}-cursor-domain`,
        name: cursorExistingName,
        nameNormalized: normalizeCompanyName(cursorExistingName),
        domain: cursorExisting.domain,
        country: "GB",
      },
      {
        id: `${suffix}-cursor-1`,
        sourceRecordId: `${suffix}-cursor-name-a`,
        name: `${cursorNamePrefix} Unmatched A`,
        nameNormalized: normalizeCompanyName(`${cursorNamePrefix} Unmatched A`),
        country: "GB",
      },
      {
        id: `${suffix}-cursor-5`,
        sourceRecordId: `${suffix}-cursor-name-b`,
        name: `${cursorNamePrefix} Unmatched B`,
        nameNormalized: normalizeCompanyName(`${cursorNamePrefix} Unmatched B`),
        country: "GB",
      },
      {
        id: `${suffix}-cursor-2`,
        sourceRecordId: `${suffix}-cursor-no-key`,
        name: `${cursorNamePrefix} No Key`,
        nameNormalized: "",
      },
      {
        id: `${suffix}-cursor-4`,
        sourceRecordId: `${suffix}-cursor-name-c`,
        name: `${cursorNamePrefix} Unmatched C`,
        nameNormalized: normalizeCompanyName(`${cursorNamePrefix} Unmatched C`),
        country: "GB",
      },
    ];
    await client.worldSourceRecord.createMany({
      data: cursorRecords.map((record) => ({
        ...record,
        source: "cursor_test",
        loadRunId: cursorRun.id,
        payload: {},
      })),
    });
    const cursorCounters = await mergeSourceRecords({ client, batchSize: 2 });
    assert.equal(cursorCounters.inserted, 4);
    assert.equal(cursorCounters.matchedByDomain, 1);
    const cursorRecordsAfter = await client.worldSourceRecord.findMany({
      where: { sourceRecordId: { contains: `${suffix}-cursor-` } },
    });
    assert.equal(cursorRecordsAfter.length, 5);
    assert.ok(cursorRecordsAfter.every((record) => record.merged && record.companyId));
    const cursorCompanies = await client.worldCompany.findMany({
      where: { canonicalName: { contains: cursorNamePrefix } },
    });
    assert.equal(cursorCompanies.length, 5);
    assert.equal(cursorCompanies.reduce((total, company) => total + company.sourceCount, 0), 5);
    assert.ok(cursorCompanies.every((company) => company.sourceCount === 1));
    for (const variant of [
      { source: "late_insert_lei_test", kind: "lei" as const, identifier: "L1" },
      { source: "late_insert_name_test", kind: "name" as const, identifier: null },
    ]) {
      const existingName = `Late Insert Existing ${variant.source} ${suffix}`;
      const existingNormalized = normalizeCompanyName(existingName);
      const pendingName = `Late Insert Pending ${variant.source} ${suffix}`;
      const pendingNormalized = normalizeCompanyName(pendingName);
      const run = await client.worldLoadRun.create({
        data: { source: variant.source, fileName: `${variant.source}.csv` },
      });
      loadRunIds.push(run.id);
      const existingCompany = await client.worldCompany.create({
        data: {
          canonicalName: existingName,
          nameNormalized: existingNormalized,
          country: "GB",
          lei: variant.kind === "lei" ? variant.identifier : null,
          sourceCount: 1,
        },
      });
      const existingSource = await client.worldSourceRecord.create({
        data: {
          id: `${variant.source}-existing`,
          source: variant.source,
          sourceRecordId: `${suffix}-${variant.source}-existing`,
          loadRunId: run.id,
          name: existingName,
          nameNormalized: existingNormalized,
          country: "GB",
          lei: variant.kind === "lei" ? variant.identifier : null,
          payload: {},
        },
      });
      await client.worldSourceRecord.update({
        where: { id: existingSource.id },
        data: { companyId: existingCompany.id, merged: true },
      });
      await client.worldSourceRecord.createMany({
        data: ["w1", "w3"].map((id) => ({
          id: `${variant.source}-${id}`,
          source: variant.source,
          sourceRecordId: `${suffix}-${variant.source}-${id}`,
          loadRunId: run.id,
          name: pendingName,
          nameNormalized: pendingNormalized,
          country: "GB",
          payload: {},
        })),
      });
      let lateInsertDone = false;
      const lateInsertCounters = await mergeSourceRecords({
        client,
        batchSize: 2,
        source: variant.source,
        onBeforeLeftBehindCount: async ({ firstId }) => {
          if (lateInsertDone || firstId !== `${variant.source}-w1`) return;
          lateInsertDone = true;
          await client.worldSourceRecord.create({
            data: {
              id: `${variant.source}-w2`,
              source: variant.source,
              sourceRecordId: `${suffix}-${variant.source}-w2`,
              loadRunId: run.id,
              name: existingName,
              nameNormalized: existingNormalized,
              country: "GB",
              lei: variant.kind === "lei" ? variant.identifier : null,
              payload: {},
            },
          });
        },
      });
      const lateInsertRecords = await client.worldSourceRecord.findMany({
        where: { source: variant.source },
      });
      const lateInsertCompanyIds = new Set(
        lateInsertRecords.flatMap((record) => record.companyId ? [record.companyId] : []),
      );
      assert.equal(lateInsertCounters.leftBehind, 0);
      assert.equal(lateInsertRecords.length, 4);
      assert.ok(lateInsertRecords.every((record) => record.merged && record.companyId));
      assert.equal(lateInsertCompanyIds.size, 2);
      assert.equal(
        lateInsertRecords.find((record) => record.id === `${variant.source}-w2`)?.companyId,
        existingCompany.id,
      );
      assert.equal(
        await client.worldCompany.count({
          where: { id: { in: [...lateInsertCompanyIds] } },
        }),
        2,
      );
      if (variant.kind === "lei") assert.equal(lateInsertCounters.matchedByLei, 1);
    }

    const ambiguousBatchPrefix = `AmbiguousBatch-${suffix}`;
    const ambiguousBatchRun = await client.worldLoadRun.create({
      data: { source: "ambiguous_batch_test", fileName: "ambiguous-batch-fixture.csv" },
    });
    loadRunIds.push(ambiguousBatchRun.id);
    const ambiguousBatchName = `${ambiguousBatchPrefix} Shared`;
    const ambiguousBatchRecords = [
      ["1", "54930000000000000000000000000001"],
      ["2", "54930000000000000000000000000002"],
      ["3", null],
      ["4", null],
    ].map(([id, lei], index) => ({
      id: `${suffix}-ambiguous-batch-${id}`,
      source: "ambiguous_batch_test",
      sourceRecordId: `${suffix}-ambiguous-batch-${id}`,
      loadRunId: ambiguousBatchRun.id,
      name: ambiguousBatchName,
      nameNormalized: normalizeCompanyName(ambiguousBatchName),
      country: "GB",
      lei,
      city: index === 2 ? "Leeds" : null,
      legalIds: index === 3 ? { pdl_id: `${suffix}-sibling` } : undefined,
      industryCodes: index === 2 ? { sic: "25620" } : undefined,
      isManufacturer: index === 3,
      manufacturerEvidence: index === 3 ? [{ source: "ambiguous_batch_test" }] : undefined,
      payload: {},
    }));
    await client.worldSourceRecord.createMany({ data: ambiguousBatchRecords });
    const ambiguousBatchCounters = await mergeSourceRecords({ client, batchSize: 4 });
    assert.equal(ambiguousBatchCounters.leftBehind, 0);
    const ambiguousBatchCompanies = await client.worldCompany.findMany({
      where: { canonicalName: { contains: ambiguousBatchPrefix } },
    });
    assert.equal(ambiguousBatchCompanies.length, 3);
    const ambiguousBatchNameCompany = ambiguousBatchCompanies.find((company) => company.lei === null);
    assert.equal(ambiguousBatchNameCompany?.sourceCount, 2);
    assert.equal(ambiguousBatchNameCompany?.city, "Leeds");
    assert.deepEqual(ambiguousBatchNameCompany?.legalIds, { pdl_id: `${suffix}-sibling` });
    assert.deepEqual(ambiguousBatchNameCompany?.industryCodes, { sic: ["25620"] });
    assert.equal(ambiguousBatchNameCompany?.isManufacturer, true);
    assert.deepEqual(ambiguousBatchNameCompany?.manufacturerEvidence, [
      { source: "ambiguous_batch_test" },
    ]);
    const ambiguousBatchSources = await client.worldSourceRecord.findMany({
      where: { sourceRecordId: { contains: `${suffix}-ambiguous-batch-` } },
    });
    assert.equal(ambiguousBatchSources.length, 4);
    assert.ok(ambiguousBatchSources.every((record) => record.merged && record.companyId));

    const existingNameCollisionPrefix = `ExistingNameCollision-${suffix}`;
    const existingNameCollisionRun = await client.worldLoadRun.create({
      data: { source: "existing_name_collision_test", fileName: "existing-name-collision-fixture.csv" },
    });
    loadRunIds.push(existingNameCollisionRun.id);
    const existingNameCollision = `${existingNameCollisionPrefix} Shared`;
    await client.worldSourceRecord.createMany({
      data: ["1", "2"].map((id, index) => ({
        id: `${suffix}-existing-name-collision-${id}`,
        source: "existing_name_collision_test",
        sourceRecordId: `${suffix}-existing-name-collision-${id}`,
        loadRunId: existingNameCollisionRun.id,
        name: existingNameCollision,
        nameNormalized: normalizeCompanyName(existingNameCollision),
        country: "GB",
        lei: `${suffix}-existing-name-collision-lei-${index}`,
        payload: {},
      })),
    });
    const existingNameCollisionCounters = await mergeSourceRecords({ client, batchSize: 2 });
    assert.equal(existingNameCollisionCounters.leftBehind, 0);
    assert.equal(
      await client.worldCompany.count({ where: { canonicalName: existingNameCollision } }),
      2,
    );

    const collisionBatchRun = await client.worldLoadRun.create({
      data: { source: "collision_batch_test", fileName: "collision-batch-fixture.csv" },
    });
    loadRunIds.push(collisionBatchRun.id);
    const collisionBatchRecords = [
      {
        id: `${suffix}-collision-batch-lei`,
        sourceRecordId: `${suffix}-collision-batch-lei`,
        lei: `${suffix}-collision-batch-lei-value`,
      },
      {
        id: `${suffix}-collision-batch-name`,
        sourceRecordId: `${suffix}-collision-batch-name`,
        lei: null,
      },
      {
        id: `${suffix}-collision-batch-domain`,
        sourceRecordId: `${suffix}-collision-batch-domain`,
        domain: "collision-batch.example",
        lei: null,
      },
    ].map((record) => ({
      ...record,
      source: "collision_batch_test",
      loadRunId: collisionBatchRun.id,
      name: existingNameCollision,
      nameNormalized: normalizeCompanyName(existingNameCollision),
      country: "GB",
      payload: {},
    }));
    await client.worldSourceRecord.createMany({ data: collisionBatchRecords });
    const collisionBatchCounters = await mergeSourceRecords({ client, batchSize: 3 });
    assert.equal(collisionBatchCounters.leftBehind, 0);
    const collisionBatchSources = await client.worldSourceRecord.findMany({
      where: { sourceRecordId: { contains: `${suffix}-collision-batch-` } },
    });
    assert.equal(collisionBatchSources.length, 3);
    assert.ok(collisionBatchSources.every((record) => record.merged && record.companyId));

    const perfPrefix = `PerfBatch-${suffix}`;
    const perfRun = await client.worldLoadRun.create({
      data: { source: "perf_batch_test", fileName: "perf-batch-fixture.csv" },
    });
    loadRunIds.push(perfRun.id);
    const perfRecords = Array.from({ length: 20_000 }, (_, index) => {
      const name = `${perfPrefix} Company ${index}`;
      return {
        id: `${suffix}-perf-batch-${index}`,
        source: "perf_batch_test",
        sourceRecordId: `${suffix}-perf-batch-${index}`,
        loadRunId: perfRun.id,
        name,
        nameNormalized: normalizeCompanyName(name),
        country: "GB",
        payload: {},
      };
    });
    await client.worldSourceRecord.createMany({ data: perfRecords });
    const perfStartedAt = performance.now();
    const perfCounters = await mergeSourceRecords({ client, batchSize: 20_000 });
    const perfElapsedMs = performance.now() - perfStartedAt;
    assert.ok(perfElapsedMs < 30_000, `performance batch took ${perfElapsedMs}ms`);
    assert.equal(perfCounters.inserted, 20_000);
    assert.equal(perfCounters.leftBehind, 0);
    assert.equal(
      await client.worldCompany.count({ where: { canonicalName: { startsWith: perfPrefix } } }),
      20_000,
    );
    console.log(`world merge performance batch elapsed=${Math.round(perfElapsedMs)}ms`);

    const leiHeavyPrefix = `LeiHeavy-${suffix}`;
    const leiHeavyRun = await client.worldLoadRun.create({
      data: { source: "lei_heavy_perf_test", fileName: "lei-heavy-fixture.csv" },
    });
    loadRunIds.push(leiHeavyRun.id);
    const leiHeavyRecords = Array.from({ length: 20_000 }, (_, index) => {
      const name = `${leiHeavyPrefix} Company ${index}`;
      const common = {
        source: "lei_heavy_perf_test",
        loadRunId: leiHeavyRun.id,
        name,
        nameNormalized: normalizeCompanyName(name),
        country: "GB",
        payload: {},
      };
      return [
        {
          ...common,
          id: `${suffix}-lei-heavy-lei-${index}`,
          sourceRecordId: `${suffix}-lei-heavy-lei-${index}`,
          lei: `549300${String(index).padStart(26, "0")}`,
        },
        {
          ...common,
          id: `${suffix}-lei-heavy-name-${index}`,
          sourceRecordId: `${suffix}-lei-heavy-name-${index}`,
          lei: null,
        },
      ];
    }).flat();
    await client.worldSourceRecord.createMany({ data: leiHeavyRecords });
    const leiHeavyStartedAt = performance.now();
    const leiHeavyCounters = await mergeSourceRecords({
      client,
      batchSize: 40_000,
      source: "lei_heavy_perf_test",
    });
    const leiHeavyElapsedMs = performance.now() - leiHeavyStartedAt;
    assert.ok(leiHeavyElapsedMs < 30_000, `LEI-heavy batch took ${leiHeavyElapsedMs}ms`);
    assert.equal(leiHeavyCounters.inserted, 20_000);
    assert.equal(leiHeavyCounters.leftBehind, 0);
    assert.equal(
      await client.worldCompany.count({ where: { canonicalName: { startsWith: leiHeavyPrefix } } }),
      20_000,
    );
    const leiHeavySources = await client.worldSourceRecord.findMany({
      where: { sourceRecordId: { contains: `${suffix}-lei-heavy-` } },
    });
    assert.equal(leiHeavySources.length, 40_000);
    assert.ok(leiHeavySources.every((record) => record.merged && record.companyId));
    console.log(`world merge LEI-heavy batch elapsed=${Math.round(leiHeavyElapsedMs)}ms`);

    console.log(JSON.stringify({ ok: true, counters, companies: companies.length, records: records.length }));
  } finally {
    const testCompanyIds = (await client.worldSourceRecord.findMany({
      where: { sourceRecordId: { contains: suffix } },
      select: { companyId: true },
    })).flatMap((record) => record.companyId ? [record.companyId] : []);
    await client.worldSourceRecord.deleteMany({ where: { sourceRecordId: { contains: suffix } } });
    for (let index = 0; index < testCompanyIds.length; index += 1_000) {
      await client.worldCompany.deleteMany({
        where: { id: { in: testCompanyIds.slice(index, index + 1_000) } },
      });
    }
    if (preexistingFacilityId) await client.worldCompany.delete({ where: { id: preexistingFacilityId } });
    await client.worldCompany.deleteMany({ where: { canonicalName: { contains: suffix } } });
    if (loadRunIds.length) await client.worldLoadRun.deleteMany({ where: { id: { in: loadRunIds } } });
    await client.$disconnect();
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
