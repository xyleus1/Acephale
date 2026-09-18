import { Prisma, PrismaClient } from "@prisma/client";
import type { ExecutionFrame } from "./contracts/generated";
import type { Experience, ExperienceRepository } from "./repository";
import { validateContract } from "./contracts/validate";
import { hash } from "./canonical";

export function researchDatabase(url: string, applicationUrl?: string): PrismaClient {
  const parsed = new URL(url);
  if (!/^postgres(ql)?:$/.test(parsed.protocol) || !/^\/goalspec_[a-z0-9_]+$/.test(parsed.pathname)) throw new Error("Dedicated goalspec_ research database required");
  if (applicationUrl) {
    const app = new URL(applicationUrl);
    if (app.hostname === parsed.hostname && app.port === parsed.port && app.pathname === parsed.pathname) throw new Error("Research cannot use application database");
  }
  return new PrismaClient({ datasources: { db: { url } } });
}

export class PostgresExperienceRepository implements ExperienceRepository {
  constructor(private db: PrismaClient) {}
  async verifyFrozenRecords(snapshotId: string, records: Experience[]) {
    const snapshots = await this.db.$queryRaw<{ content_hash: string }[]>(Prisma.sql`
      SELECT content_hash FROM goalspec.repository_snapshot WHERE id = ${snapshotId} AND publication_state = 'frozen'`);
    if (snapshots.length !== 1) throw new Error("Frozen snapshot unavailable");
    const rows = await this.db.$queryRaw<{ id: string; family_id: string; text_content: string; payload: Experience["pattern"] }[]>(Prisma.sql`
      SELECT p.id,e.family_id,p.text_content,p.payload FROM goalspec.workflow_pattern p JOIN goalspec.episode e ON e.id=p.episode_id WHERE p.snapshot_id=${snapshotId} ORDER BY p.id`);
    const stored = rows.map(row => ({ id: row.id, familyId: row.family_id, text: row.text_content, pattern: row.payload, split: "train" })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const expected = records.map(row => ({ id: row.id, familyId: row.familyId, text: row.text, pattern: row.pattern, split: row.split })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    if (hash(stored) !== hash(expected)) throw new Error("Frozen repository records differ from the experiment artifact");
    // pgvector stores float32. Publication hashes retain the original provider
    // vector bytes, while this equality check compares exact semantic records.
    return snapshots[0].content_hash;
  }
  async retrieve(frame: ExecutionFrame, query: string, embedding: number[], limit = 8): Promise<Experience[]> {
    if (embedding.length !== 1536 || embedding.some(x => !Number.isFinite(x))) throw new Error("Invalid embedding");
    if (!Number.isFinite(limit)) throw new Error("Invalid retrieval limit");
    const snapshots = await this.db.$queryRaw<{ content_hash: string }[]>(Prisma.sql`
      SELECT content_hash FROM goalspec.repository_snapshot WHERE id = ${frame.snapshotId} AND publication_state = 'frozen'`);
    if (snapshots.length !== 1) throw new Error("Frozen snapshot unavailable");
    const scope = frame.scope;
    const rows = await this.db.$queryRaw<{ id: string; family_id: string; text_content: string; payload: Experience["pattern"]; vector: string }[]>(Prisma.sql`
      WITH compatible AS MATERIALIZED (
        SELECT p.*, e.family_id FROM goalspec.workflow_pattern p
        JOIN goalspec.repository_snapshot s ON s.id = p.snapshot_id
        JOIN goalspec.episode e ON e.id = p.episode_id
        WHERE s.id = ${frame.snapshotId} AND s.publication_state = 'frozen'
          AND p.tenant_id = ${scope.tenantId} AND p.principal_id = ${scope.principalId}
          AND p.authorization_version = ${scope.authorizationVersion}
          AND p.environment_version = ${scope.environmentVersion} AND p.tool_schema_hash = ${scope.toolSchemaHash}
          AND p.verification_tier = 'native_verified' AND e.verification_tier = 'native_verified' AND e.split = 'train'
          AND e.environment_version = ${scope.environmentVersion} AND e.tool_schema_hash = ${scope.toolSchemaHash}
          AND EXISTS(SELECT 1 FROM goalspec.snapshot_episode m WHERE m.snapshot_id = s.id AND m.episode_id = e.id AND m.content_hash = e.content_hash)
          AND EXISTS(SELECT 1 FROM goalspec.episode_verification v WHERE v.episode_id = e.id)
      ) SELECT p.id, p.family_id, p.text_content, p.payload, v.context_vector::text AS vector
        FROM compatible p JOIN goalspec.pattern_embedding v ON v.pattern_id = p.id AND v.snapshot_id = p.snapshot_id
        LEFT JOIN goalspec.goal_transition_stats t ON t.snapshot_id = p.snapshot_id AND t.key = p.id
        LEFT JOIN goalspec.snapshot_prediction_error c ON c.snapshot_id = p.snapshot_id AND c.key = p.id
        WHERE v.model = 'text-embedding-3-small'
        ORDER BY COALESCE(1 - (v.context_vector <=> ${JSON.stringify(embedding)}::vector), 0)
          + ts_rank_cd(p.search_document, plainto_tsquery('english', ${query}))
          + 0.25 * COALESCE(t.matches::double precision / NULLIF(t.opportunities, 0), 0)
          - 0.25 * COALESCE(c.errors::double precision / c.observations, 0) DESC, p.id
        LIMIT ${Math.max(0, Math.min(32, Math.floor(limit)))}`);
    return rows.map(row => {
      validateContract("WorkflowPattern", row.payload);
      if (row.payload.id !== row.id || hash(row.payload.scope) !== hash(scope) || row.payload.snapshotId !== frame.snapshotId || row.payload.verificationTier !== "native_verified") throw new Error("Repository hydration scope mismatch");
      return { id: row.id, familyId: row.family_id, text: row.text_content, pattern: row.payload, embedding: JSON.parse(row.vector), split: "train" };
    });
  }
}
