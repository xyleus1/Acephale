import { Prisma, type PrismaClient } from "@prisma/client";
import { hash } from "./canonical";
import { validateContract } from "./contracts/validate";
import type { Experience } from "./repository";

export interface DatasetRecord {
  id: string; source: string; revision: string; contentHash: string; license: string;
  parserVersion: string; rawCount: number; admittedCount: number; metadata: Record<string, unknown>;
}
export interface EpisodeRecord {
  id: string; datasetId: string; sourceId: string; domain: string; familyId: string;
  split: "train" | "development" | "test"; environmentVersion: string; toolSchemaHash: string;
  verificationTier: "quarantine" | "source_reported" | "independent_replay" | "native_verified";
  transcriptUri: string; contentHash: string; metadata: Record<string, unknown>;
}
export interface VerificationRecord {
  episodeId: string; verifierVersion: string; verifierCodeHash: string; evidenceHash: string;
  evidenceUri: string; success: boolean; constraintsSatisfied: boolean; verdict: Record<string, unknown>;
}
export interface PublishedExperience extends Experience { episodeId: string; supportingEpisodeIds?: string[]; goalEmbedding?: number[] }
export interface TransitionRecord {
  key: string; goal: string; opportunities: number; matches: number; independentSupport: number;
  sourceEpisodeIds: string[]; outcomeStrata: Record<string, unknown>;
}
export interface ErrorRecord {
  key: string; tool: string; observations: number; errors: number; sourceEpisodeIds: string[]; details: Record<string, unknown>;
}
export interface SnapshotPublication {
  id: string; records: PublishedExperience[]; episodeIds: string[]; heldoutFamilies: string[];
  transitions: TransitionRecord[]; errors: ErrorRecord[]; compilerVersion: string;
  embeddingModelVersion: string; calibration: Record<string, unknown>;
}
const isHash = (value: string) => /^[a-f0-9]{64}$/.test(value);
function nonnegative(value: number) { return Number.isSafeInteger(value) && value >= 0; }
function assertVector(value: number[]) {
  if (value.length !== 1536 || value.some(n => !Number.isFinite(n)) || !value.some(n => n !== 0)) throw new Error("Expected nonzero finite 1536-dimensional embedding");
}
function json(value: unknown) { return JSON.stringify(value); }

/** All methods write only immutable inputs or a new, transactionally frozen snapshot. */
export class PostgresPublicationStore {
  constructor(private db: PrismaClient) {}

  async importDataset(manifest: DatasetRecord, episodes: EpisodeRecord[]) {
    if (!manifest.id || !isHash(manifest.contentHash) || !manifest.source || !manifest.revision || !manifest.license ||
        !nonnegative(manifest.rawCount) || !nonnegative(manifest.admittedCount) || manifest.admittedCount > manifest.rawCount ||
        episodes.length !== manifest.admittedCount || new Set(episodes.map(e => e.id)).size !== episodes.length) throw new Error("Invalid dataset manifest");
    const families = new Map<string, string>();
    for (const episode of episodes) {
      if (episode.datasetId !== manifest.id || !isHash(episode.contentHash) || !isHash(episode.toolSchemaHash) || !episode.environmentVersion ||
          !episode.familyId || !episode.transcriptUri || !["train", "development", "test"].includes(episode.split)) throw new Error("Invalid episode metadata");
      if (families.has(episode.familyId) && families.get(episode.familyId) !== episode.split) throw new Error("Task family crosses dataset splits");
      families.set(episode.familyId, episode.split);
    }
    // The manifest identifies both source bytes and their exact admitted metadata.
    const importHash = hash({ manifest, episodes });
    return this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(72489101)`;
      const previous = await tx.$queryRaw<{ metadata: Record<string, unknown> }[]>(Prisma.sql`SELECT metadata FROM goalspec.dataset_manifest WHERE id = ${manifest.id}`);
      if (previous.length) {
        if (previous[0].metadata.importHash !== importHash) throw new Error("Immutable dataset manifest conflict");
        return { imported: 0, existing: episodes.length, importHash };
      }
      await tx.$executeRaw(Prisma.sql`INSERT INTO goalspec.dataset_manifest
        (id, source, revision, content_hash, license, parser_version, raw_count, admitted_count, metadata)
        VALUES(${manifest.id}, ${manifest.source}, ${manifest.revision}, ${manifest.contentHash}, ${manifest.license}, ${manifest.parserVersion},
          ${manifest.rawCount}, ${manifest.admittedCount}, ${json({ ...manifest.metadata, importHash })}::jsonb)`);
      for (let offset = 0; offset < episodes.length; offset += 100) {
        await tx.$executeRaw(Prisma.sql`INSERT INTO goalspec.episode
          (id,dataset_id,source_id,domain,family_id,split,environment_version,tool_schema_hash,verification_tier,transcript_uri,content_hash,metadata)
          SELECT x."id",x."datasetId",x."sourceId",x."domain",x."familyId",x."split",x."environmentVersion",x."toolSchemaHash",x."verificationTier",x."transcriptUri",x."contentHash",x."metadata"
          FROM jsonb_to_recordset(${json(episodes.slice(offset, offset + 100))}::jsonb) AS x("id" text,"datasetId" text,"sourceId" text,"domain" text,"familyId" text,"split" text,"environmentVersion" text,"toolSchemaHash" text,"verificationTier" text,"transcriptUri" text,"contentHash" text,"metadata" jsonb)`);
      }
      return { imported: episodes.length, existing: 0, importHash };
    }, { timeout: 120_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async recordVerification(verification: VerificationRecord) {
    if (![verification.verifierCodeHash, verification.evidenceHash].every(isHash) || !verification.verifierVersion || !verification.evidenceUri ||
        typeof verification.success !== "boolean" || typeof verification.constraintsSatisfied !== "boolean") throw new Error("Invalid independent verification");
    return this.db.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ verification_tier: string }[]>(Prisma.sql`SELECT verification_tier FROM goalspec.episode WHERE id = ${verification.episodeId}`);
      if (rows.length !== 1 || !["independent_replay", "native_verified"].includes(rows[0].verification_tier)) throw new Error("Source reported records cannot gain native verification");
      await tx.$executeRaw(Prisma.sql`INSERT INTO goalspec.episode_verification
        (episode_id,verifier_version,verifier_code_hash,evidence_hash,evidence_uri,success,constraints_satisfied,verdict)
        VALUES(${verification.episodeId},${verification.verifierVersion},${verification.verifierCodeHash},${verification.evidenceHash},${verification.evidenceUri},${verification.success},${verification.constraintsSatisfied},${json(verification.verdict)}::jsonb)`);
    });
  }

  async annotate(episodeId: string, checkpoint: number, visibleInputHash: string, teacherVersion: string, annotation: unknown) {
    if (!nonnegative(checkpoint) || !isHash(visibleInputHash) || !teacherVersion) throw new Error("Invalid annotation provenance");
    const id = hash({ episodeId, checkpoint, visibleInputHash, teacherVersion, annotation });
    await this.db.$executeRaw(Prisma.sql`INSERT INTO goalspec.goal_annotation
      (id,episode_id,checkpoint,visible_input_hash,teacher_version,annotation)
      VALUES(${id},${episodeId},${checkpoint},${visibleInputHash},${teacherVersion},${json(annotation)}::jsonb) ON CONFLICT(id) DO NOTHING`);
    return id;
  }

  async publish(publication: SnapshotPublication) {
    if (!publication.id || !publication.compilerVersion || !publication.embeddingModelVersion ||
        new Set(publication.records.map(r => r.id)).size !== publication.records.length ||
        new Set(publication.episodeIds).size !== publication.episodeIds.length) throw new Error("Invalid snapshot publication");
    const memberIds = new Set(publication.episodeIds);
    for (const record of publication.records) {
      validateContract("WorkflowPattern", record.pattern);
      if (record.id !== record.pattern.id || record.pattern.snapshotId !== publication.id || record.pattern.verificationTier !== "native_verified" ||
          record.split !== "train" || publication.heldoutFamilies.includes(record.familyId) || !memberIds.has(record.episodeId) ||
          record.supportingEpisodeIds?.some(id => !memberIds.has(id))) throw new Error("Snapshot contamination or pattern identity mismatch");
      assertVector(record.embedding); if (record.goalEmbedding) assertVector(record.goalEmbedding);
    }
    const patternIds = new Set(publication.records.map(r => r.id));
    for (const transition of publication.transitions) {
      if (!patternIds.has(transition.key) || ![transition.opportunities, transition.matches, transition.independentSupport].every(nonnegative) ||
          transition.matches > transition.opportunities || transition.independentSupport > new Set(transition.sourceEpisodeIds).size ||
          !transition.sourceEpisodeIds.length || transition.sourceEpisodeIds.some(id => !memberIds.has(id))) throw new Error("Invalid training-only transition provenance");
    }
    for (const error of publication.errors) {
      if (!patternIds.has(error.key) || !nonnegative(error.observations) || !nonnegative(error.errors) || !error.observations || error.errors > error.observations ||
          !error.sourceEpisodeIds.length || error.sourceEpisodeIds.some(id => !memberIds.has(id))) throw new Error("Invalid training-only error provenance");
    }
    return this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(72489101)`;
      const members = publication.episodeIds.length ? await tx.$queryRaw<{ id: string; family_id: string; split: string; content_hash: string; verification_tier: string; environment_version: string; tool_schema_hash: string; verifier: string | null; success: boolean | null; constraints_satisfied: boolean | null }[]>(Prisma.sql`
        SELECT e.*,v.episode_id AS verifier,v.success,v.constraints_satisfied FROM goalspec.episode e LEFT JOIN goalspec.episode_verification v ON v.episode_id = e.id
        WHERE e.id IN (${Prisma.join(publication.episodeIds)}) ORDER BY e.id`) : [];
      if (members.length !== memberIds.size || members.some(e => e.split !== "train" || publication.heldoutFamilies.includes(e.family_id))) throw new Error("Snapshot contains missing or held-out source episodes");
      const byId = new Map(members.map(e => [e.id, e]));
      for (const transition of publication.transitions) {
        const sources = transition.sourceEpisodeIds.map(id => byId.get(id)!);
        if (sources.some(source => source.verification_tier !== "native_verified" || !source.verifier) ||
            transition.independentSupport > new Set(sources.map(source => source.family_id)).size) throw new Error("Transition support must count independently verified training families");
      }
      for (const error of publication.errors) {
        if (error.sourceEpisodeIds.some(id => byId.get(id)!.verification_tier !== "native_verified" || !byId.get(id)!.verifier)) throw new Error("Prediction errors require independently verified training sources");
      }
      for (const record of publication.records) {
        const source = byId.get(record.episodeId)!;
        for (const id of new Set([record.episodeId, ...record.supportingEpisodeIds ?? []])) {
          const support = byId.get(id)!;
          if (support.verification_tier !== "native_verified" || !support.verifier || support.environment_version !== record.pattern.scope.environmentVersion ||
              support.tool_schema_hash !== record.pattern.scope.toolSchemaHash) throw new Error("Pattern lacks compatible independent native verification");
        }
        if (source.family_id !== record.familyId || (record.pattern.successes > 0 && (!source.success || !source.constraints_satisfied))) throw new Error("Pattern endpoint does not support successful workflow");
      }
      const memberHashes = members.map(e => ({ id: e.id, hash: e.content_hash }));
      const contentHash = hash({ publication, memberHashes });
      const previous = await tx.$queryRaw<{ content_hash: string; publication_state: string }[]>(Prisma.sql`SELECT content_hash,publication_state FROM goalspec.repository_snapshot WHERE id = ${publication.id}`);
      if (previous.length) {
        if (previous[0].content_hash !== contentHash || previous[0].publication_state !== "frozen") throw new Error("Immutable snapshot conflict");
        return { id: publication.id, contentHash, records: publication.records.length, existing: true };
      }
      const manifest = { compilerVersion: publication.compilerVersion, embeddingModelVersion: publication.embeddingModelVersion,
        heldoutFamilies: publication.heldoutFamilies, calibration: publication.calibration, memberHashes,
        publicationHash: hash(publication), support: publication.records.map(r => ({ id: r.id, episodes: [r.episodeId, ...r.supportingEpisodeIds ?? []] })) };
      await tx.$executeRaw(Prisma.sql`INSERT INTO goalspec.repository_snapshot(id,content_hash,publication_state,manifests) VALUES(${publication.id},${contentHash},'staging',${json(manifest)}::jsonb)`);
      for (const member of members) await tx.$executeRaw(Prisma.sql`INSERT INTO goalspec.snapshot_episode(snapshot_id,episode_id,content_hash) VALUES(${publication.id},${member.id},${member.content_hash})`);
      for (const record of publication.records) {
        const p = record.pattern, s = p.scope;
        await tx.$executeRaw(Prisma.sql`INSERT INTO goalspec.workflow_pattern(id,snapshot_id,episode_id,tenant_id,principal_id,authorization_version,environment_version,tool_schema_hash,verification_tier,goal_family,text_content,payload)
          VALUES(${p.id},${publication.id},${record.episodeId},${s.tenantId},${s.principalId},${s.authorizationVersion},${s.environmentVersion},${s.toolSchemaHash},${p.verificationTier},${record.familyId},${record.text},${json(p)}::jsonb)`);
        await tx.$executeRaw(Prisma.sql`INSERT INTO goalspec.pattern_embedding(pattern_id,snapshot_id,model,model_version,goal_vector,context_vector)
          VALUES(${p.id},${publication.id},'text-embedding-3-small',${publication.embeddingModelVersion},${json(record.goalEmbedding ?? record.embedding)}::vector,${json(record.embedding)}::vector)`);
      }
      for (const t of publication.transitions) await tx.$executeRaw(Prisma.sql`INSERT INTO goalspec.goal_transition_stats(snapshot_id,key,goal,opportunities,matches,independent_support,outcome_strata)
        VALUES(${publication.id},${t.key},${t.goal},${t.opportunities},${t.matches},${t.independentSupport},${json({ ...t.outcomeStrata, sourceEpisodeIds: t.sourceEpisodeIds })}::jsonb)`);
      for (const e of publication.errors) await tx.$executeRaw(Prisma.sql`INSERT INTO goalspec.snapshot_prediction_error(snapshot_id,key,tool,observations,errors,source_episode_ids,details)
        VALUES(${publication.id},${e.key},${e.tool},${e.observations},${e.errors},${json(e.sourceEpisodeIds)}::jsonb,${json(e.details)}::jsonb)`);
      await tx.$executeRaw(Prisma.sql`UPDATE goalspec.repository_snapshot SET publication_state = 'frozen' WHERE id = ${publication.id}`);
      return { id: publication.id, contentHash, records: publication.records.length, existing: false };
    }, { timeout: 120_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
