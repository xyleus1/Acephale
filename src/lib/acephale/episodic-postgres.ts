import type { ResearchDatabase } from "./postgres-store";
import { canonical, hash } from "./canonical";
import { validateMemoryArtifact, type FrozenExperienceMemory } from "./experience-memory";
import { EpisodicIntegrityError, normalizeEpisodeVector, validateEpisodeEmbeddings,
  type EpisodicSearchPort, type EpisodicSearchHit, type FrozenEpisodeEmbeddings } from "./episodic-retrieval";

/** Publishes a separate immutable checkpoint index, never executable workflow rows. */
export async function publishEpisodicMemory(db: ResearchDatabase, memoryInput: FrozenExperienceMemory, embeddingInput: FrozenEpisodeEmbeddings) {
  const memory = validateMemoryArtifact(memoryInput), embeddings = validateEpisodeEmbeddings(embeddingInput, memory);
  const runs = new Map(memory.runs.map(run => [run.id, run])), episodes = new Map(memory.episodes.map(row => [row.id, row]));
  const contentHash = hash({ memoryHash: memory.contentHash, embeddingsHash: embeddings.contentHash });
  const manifest = { kind: "frozen-episodic-memory-v1", memoryHash: memory.contentHash, embeddingsHash: embeddings.contentHash,
    model: embeddings.model, modelVersion: embeddings.modelVersion, projectionHash: embeddings.projectionHash,
    sourceFiles: memory.sourceFiles, rows: embeddings.rows.length };
  return db.transaction(async tx => {
    await tx.query("SELECT pg_advisory_xact_lock(72489101)");
    const previous = await tx.query<{ content_hash: string; publication_state: string; manifests: unknown }>(`
      SELECT content_hash,publication_state,manifests FROM acephale.repository_snapshot WHERE id=$1`, [memory.repositorySnapshotId]);
    if (previous.length) {
      if (previous.length !== 1 || previous[0].content_hash !== contentHash || previous[0].publication_state !== "frozen") throw new EpisodicIntegrityError("Immutable episodic snapshot conflict");
      if (canonical(previous[0].manifests) !== canonical(manifest)) throw new EpisodicIntegrityError("Frozen episodic manifest changed");
      const stored = await tx.query<{ body: Record<string, unknown>; vector: string }>(`
        SELECT to_jsonb(c)-'context_vector'-'search_document' AS body,context_vector::text AS vector
        FROM acephale.memory_checkpoint c WHERE snapshot_id=$1`, [memory.repositorySnapshotId]);
      const expected = embeddings.rows.map(row => {
        const run = runs.get(episodes.get(row.episodeId)!.runId)!;
        return { body: { snapshot_id: memory.repositorySnapshotId, id: row.episodeId, run_id: run.id, family_id: run.familyId,
          scope_hash: hash(run.scope), policy_hash: run.policyHash, memory_hash: memory.contentHash, embeddings_hash: embeddings.contentHash,
          episode_hash: row.episodeHash, text_hash: row.textHash, vector_hash: row.vectorHash, model: embeddings.model,
          model_version: embeddings.modelVersion, projection_hash: embeddings.projectionHash, split: "train", verification_tier: "native_verified",
          outcome_verified: true, outcome_class: run.success ? "success" : "task_failure", text_content: row.text }, vector: row.vector };
      });
      const hydrated = stored.map(row => ({ body: row.body, vector: (JSON.parse(row.vector) as number[]).map(Math.fround) }));
      const sorted = <T extends { body: { id?: unknown } }>(rows: T[]) => rows.sort((a, b) => String(a.body.id).localeCompare(String(b.body.id)));
      if (canonical(sorted(hydrated)) !== canonical(sorted(expected))) throw new EpisodicIntegrityError("Frozen episodic rows are incomplete or changed");
      return { snapshotId: memory.repositorySnapshotId, contentHash, existing: true, rows: embeddings.rows.length };
    }
    await tx.query(`INSERT INTO acephale.repository_snapshot(id,content_hash,publication_state,manifests)
      VALUES($1,$2,'staging',$3::jsonb)`, [memory.repositorySnapshotId, contentHash, JSON.stringify(manifest)]);
    for (const row of embeddings.rows) {
      const episode = episodes.get(row.episodeId)!, run = runs.get(episode.runId)!;
      await tx.query(`INSERT INTO acephale.memory_checkpoint
        (snapshot_id,id,run_id,family_id,scope_hash,policy_hash,memory_hash,embeddings_hash,episode_hash,text_hash,vector_hash,
         model,model_version,projection_hash,split,verification_tier,outcome_verified,outcome_class,text_content,context_vector)
        VALUES($1,$2,$3,$4,$5,$6,
          $7,$8,$9,$10,$11,
          $12,$13,$14,'train','native_verified',true,
          $15,$16,$17::vector)`, [memory.repositorySnapshotId, row.episodeId, run.id, run.familyId, hash(run.scope), run.policyHash, memory.contentHash, embeddings.contentHash, row.episodeHash, row.textHash, row.vectorHash, embeddings.model, embeddings.modelVersion, embeddings.projectionHash, run.success ? "success" : "task_failure", row.text, JSON.stringify(row.vector)]);
    }
    await tx.query(`UPDATE acephale.repository_snapshot SET publication_state='frozen' WHERE id=$1`, [memory.repositorySnapshotId]);
    return { snapshotId: memory.repositorySnapshotId, contentHash, existing: false, rows: embeddings.rows.length };
  }, { isolationLevel: "SERIALIZABLE", statementTimeoutMs: 120_000 });
}

/** Compatibility filters precede exact cosine ranking in a materialized relation. */
export function postgresEpisodicSearch(db: ResearchDatabase): EpisodicSearchPort {
  return async (request, signal) => {
    signal.throwIfAborted();
    if (!request.allowedFamilies.length || !request.allowedEpisodeIds.length) return [];
    if (!Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0 || request.timeoutMs > 100) throw new Error("Invalid retrieval timeout");
    const vector = normalizeEpisodeVector(request.vector);
    const words = [...new Set(request.query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])].filter(word => word !== "or").slice(0, 64).join(" OR ");
    const result = await db.transaction(async tx => {
      const rows = await tx.query<{ id: string; episode_hash: string; lexical_rank: number | null; dense_rank: number | null }>(`
        WITH compatible AS MATERIALIZED (
          SELECT c.* FROM acephale.memory_checkpoint c JOIN acephale.repository_snapshot s ON s.id=c.snapshot_id
          WHERE c.snapshot_id=$1 AND s.publication_state='frozen'
            AND s.manifests->>'memoryHash'=$2 AND s.manifests->>'embeddingsHash'=$3
            AND c.memory_hash=$2 AND c.embeddings_hash=$3
            AND c.scope_hash=$4 AND c.policy_hash=$5
            AND c.model=$6 AND c.model_version=$7 AND c.projection_hash=$8
            AND c.split='train' AND c.verification_tier='native_verified' AND c.outcome_verified
            AND c.family_id=ANY($9::text[]) AND c.run_id<>$10
            AND NOT(c.family_id=ANY($11::text[])) AND c.id=ANY($12::text[])
        ), lexical_top AS (
          SELECT id,episode_hash,ts_rank_cd(search_document,websearch_to_tsquery('simple',$13)) AS score
          FROM compatible WHERE search_document @@ websearch_to_tsquery('simple',$13) ORDER BY score DESC,id LIMIT 32
        ), lexical AS (SELECT id,episode_hash,(row_number() OVER(ORDER BY score DESC,id))::integer AS rank FROM lexical_top),
        dense_top AS (
          SELECT id,episode_hash,context_vector <=> $14::vector AS distance FROM compatible ORDER BY distance,id LIMIT 32
        ), dense AS (SELECT id,episode_hash,(row_number() OVER(ORDER BY distance,id))::integer AS rank FROM dense_top)
        SELECT COALESCE(l.id,d.id) AS id,COALESCE(l.episode_hash,d.episode_hash) AS episode_hash,
          l.rank AS lexical_rank,d.rank AS dense_rank FROM lexical l FULL OUTER JOIN dense d ON d.id=l.id`, [
        request.snapshotId, request.memoryHash, request.embeddingsHash, request.scopeHash, request.policyHash,
        request.model, request.modelVersion, request.projectionHash, request.allowedFamilies, request.excludedRunId,
        request.excludedFamilies, request.allowedEpisodeIds, words, JSON.stringify(vector)]);
      return rows.map((row): EpisodicSearchHit => ({ episodeId: row.id, episodeHash: row.episode_hash,
        lexicalRank: row.lexical_rank, denseRank: row.dense_rank }));
    }, { readOnly: true, statementTimeoutMs: Math.max(1, Math.floor(request.timeoutMs)), acquireTimeoutMs: Math.max(1, Math.floor(request.timeoutMs)), signal });
    signal.throwIfAborted(); return result;
  };
}
