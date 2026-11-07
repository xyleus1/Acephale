-- Dedicated research database only. No application schema changes.
BEGIN;
CREATE TABLE goalspec.memory_checkpoint (
  snapshot_id text NOT NULL REFERENCES goalspec.repository_snapshot(id), id text NOT NULL,
  run_id text NOT NULL, family_id text NOT NULL, scope_hash text NOT NULL, policy_hash text NOT NULL,
  memory_hash text NOT NULL, embeddings_hash text NOT NULL, episode_hash text NOT NULL,
  text_hash text NOT NULL, vector_hash text NOT NULL,
  model text NOT NULL CHECK(model='text-embedding-3-small'), model_version text NOT NULL, projection_hash text NOT NULL,
  split text NOT NULL CHECK(split='train'), verification_tier text NOT NULL CHECK(verification_tier='native_verified'),
  outcome_verified boolean NOT NULL CHECK(outcome_verified), outcome_class text NOT NULL CHECK(outcome_class IN ('success','task_failure')),
  text_content text NOT NULL, search_document tsvector GENERATED ALWAYS AS(to_tsvector('simple',text_content)) STORED,
  context_vector vector(1536) NOT NULL, PRIMARY KEY(snapshot_id,id)
);
CREATE INDEX memory_checkpoint_scope ON goalspec.memory_checkpoint(snapshot_id,scope_hash,policy_hash,family_id);
CREATE INDEX memory_checkpoint_lexical ON goalspec.memory_checkpoint USING gin(search_document);
-- Exact filtered cosine is intentional. There is no cross-scope ANN index.
CREATE TRIGGER memory_checkpoint_frozen BEFORE INSERT OR UPDATE OR DELETE ON goalspec.memory_checkpoint
  FOR EACH ROW EXECUTE FUNCTION goalspec.protect_snapshot();
COMMIT;
