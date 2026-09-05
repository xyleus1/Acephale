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
  const companiesFile = path.join(tempDir, "companies.csv");
  const pdlFile = path.join(tempDir, "pdl.csv");
  const pdlJsonlFile = path.join(tempDir, "pdl.jsonl");
  const loadRunIds: string[] = [];

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
    assert.ok(counters.matchedByName >= 1);
    const companies = await client.worldCompany.findMany({
      where: { canonicalName: { contains: suffix } },
      orderBy: { canonicalName: "asc" },
    });
    assert.equal(companies.length, 3);
    const shared = companies.find((company) => company.domain === `${suffix}.test`);
    assert.ok(shared?.isManufacturer);
    assert.deepEqual(shared?.legalIds, { companies_house: `${suffix}1`, pdl_id: `${suffix}-pdl-domain` });
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
    console.log(JSON.stringify({ ok: true, counters, companies: companies.length, records: records.length }));
  } finally {
    await client.worldSourceRecord.deleteMany({ where: { sourceRecordId: { contains: suffix } } });
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
