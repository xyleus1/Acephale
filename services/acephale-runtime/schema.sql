-- Research database only. Never apply to an application database.
BEGIN;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS acephale;
SET search_path TO acephale, public;
CREATE TABLE dataset_manifest (
  id text PRIMARY KEY, source text NOT NULL, revision text NOT NULL, content_hash text NOT NULL,
  license text NOT NULL, parser_version text NOT NULL, raw_count bigint NOT NULL CHECK(raw_count >= 0),
  admitted_count bigint NOT NULL CHECK(admitted_count >= 0 AND admitted_count <= raw_count), metadata jsonb NOT NULL
);
CREATE TABLE episode (
  id text PRIMARY KEY, dataset_id text NOT NULL REFERENCES dataset_manifest(id), source_id text NOT NULL,
  domain text NOT NULL, family_id text NOT NULL, split text NOT NULL CHECK(split IN ('train','development','test')),
  environment_version text NOT NULL, tool_schema_hash text NOT NULL,
  verification_tier text NOT NULL CHECK(verification_tier IN ('quarantine','source_reported','independent_replay','native_verified')),
  transcript_uri text NOT NULL, content_hash text NOT NULL UNIQUE, metadata jsonb NOT NULL
);
CREATE INDEX episode_family_split ON episode(family_id, split);
CREATE TABLE task_family (
  id text PRIMARY KEY, split text NOT NULL CHECK(split IN ('train','development','test'))
);
CREATE FUNCTION preserve_family_split() RETURNS trigger LANGUAGE plpgsql SET search_path = acephale, public AS $$
BEGIN
  INSERT INTO task_family(id, split) VALUES(NEW.family_id, NEW.split) ON CONFLICT(id) DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM task_family WHERE id = NEW.family_id AND split = NEW.split) THEN
    RAISE EXCEPTION 'Task family crosses dataset splits';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER episode_family_split_guard BEFORE INSERT ON episode FOR EACH ROW EXECUTE FUNCTION preserve_family_split();
CREATE TABLE episode_verification (
  episode_id text PRIMARY KEY REFERENCES episode(id), verifier_version text NOT NULL,
  verifier_code_hash text NOT NULL, evidence_hash text NOT NULL, evidence_uri text NOT NULL,
  success boolean NOT NULL, constraints_satisfied boolean NOT NULL, verdict jsonb NOT NULL
);
CREATE TABLE goal_annotation (
  id text PRIMARY KEY, episode_id text NOT NULL REFERENCES episode(id), checkpoint bigint NOT NULL CHECK(checkpoint >= 0),
  visible_input_hash text NOT NULL, teacher_version text NOT NULL, reviewer_version text, annotation jsonb NOT NULL
);
CREATE TABLE repository_snapshot (
  id text PRIMARY KEY, content_hash text NOT NULL UNIQUE, publication_state text NOT NULL CHECK(publication_state IN ('staging','frozen')),
  manifests jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE snapshot_episode (
  snapshot_id text NOT NULL REFERENCES repository_snapshot(id), episode_id text NOT NULL REFERENCES episode(id),
  content_hash text NOT NULL, PRIMARY KEY(snapshot_id, episode_id)
);
CREATE TABLE workflow_pattern (
  id text NOT NULL, snapshot_id text NOT NULL REFERENCES repository_snapshot(id), episode_id text NOT NULL REFERENCES episode(id),
  tenant_id text NOT NULL, principal_id text NOT NULL, authorization_version text NOT NULL,
  environment_version text NOT NULL, tool_schema_hash text NOT NULL, verification_tier text NOT NULL,
  goal_family text NOT NULL, text_content text NOT NULL, payload jsonb NOT NULL,
  search_document tsvector GENERATED ALWAYS AS (to_tsvector('english', text_content)) STORED,
  PRIMARY KEY(snapshot_id, id)
);
CREATE INDEX pattern_scope ON workflow_pattern(snapshot_id, tenant_id, principal_id, authorization_version, environment_version, tool_schema_hash, verification_tier);
CREATE INDEX pattern_lexical ON workflow_pattern USING gin(search_document);
CREATE TABLE pattern_embedding (
  pattern_id text NOT NULL, snapshot_id text NOT NULL REFERENCES repository_snapshot(id), model text NOT NULL CHECK(model = 'text-embedding-3-small'),
  model_version text NOT NULL, goal_vector vector(1536) NOT NULL, context_vector vector(1536) NOT NULL,
  PRIMARY KEY(snapshot_id, pattern_id), FOREIGN KEY(snapshot_id, pattern_id) REFERENCES workflow_pattern(snapshot_id, id)
);
CREATE INDEX pattern_goal_vector ON pattern_embedding USING hnsw(goal_vector vector_cosine_ops);
CREATE INDEX pattern_context_vector ON pattern_embedding USING hnsw(context_vector vector_cosine_ops);
CREATE TABLE run_manifest (
  id text PRIMARY KEY, snapshot_id text NOT NULL REFERENCES repository_snapshot(id),
  experiment_kind text NOT NULL CHECK(experiment_kind IN ('prediction_replay','execution_replay','live_native')),
  arm text NOT NULL, manifest jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE execution_event (
  run_id text NOT NULL REFERENCES run_manifest(id), seq bigint NOT NULL CHECK(seq >= 0), trace_id text NOT NULL,
  event_type text NOT NULL, event jsonb NOT NULL, artifact_uri text, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(run_id, seq)
);
CREATE TABLE prediction_record (
  id text PRIMARY KEY, run_id text NOT NULL REFERENCES run_manifest(id), boundary bigint NOT NULL,
  visible_input_hash text NOT NULL, candidate jsonb NOT NULL, admission text NOT NULL, reason text
);
CREATE TABLE execution_frame (
  run_id text NOT NULL REFERENCES run_manifest(id), boundary bigint NOT NULL CHECK(boundary >= 0),
  frame_hash text NOT NULL, input_hash text, provenance text NOT NULL CHECK(provenance IN ('runtime','reconstructed_native_prefix')),
  frame jsonb NOT NULL, PRIMARY KEY(run_id,boundary)
);
CREATE TABLE goal_hypothesis (
  run_id text NOT NULL, boundary bigint NOT NULL, revision_hash text NOT NULL, goals jsonb NOT NULL,
  PRIMARY KEY(run_id,boundary), FOREIGN KEY(run_id,boundary) REFERENCES execution_frame(run_id,boundary)
);
CREATE TABLE evidence_observation (
  run_id text NOT NULL, boundary bigint NOT NULL, evidence_id text NOT NULL, evidence_hash text NOT NULL, evidence jsonb NOT NULL,
  PRIMARY KEY(run_id,boundary,evidence_id), FOREIGN KEY(run_id,boundary) REFERENCES execution_frame(run_id,boundary)
);
CREATE TABLE goal_transition_stats (
  snapshot_id text NOT NULL REFERENCES repository_snapshot(id), key text NOT NULL, goal text NOT NULL,
  opportunities bigint NOT NULL CHECK(opportunities >= 0), matches bigint NOT NULL CHECK(matches >= 0 AND matches <= opportunities),
  independent_support bigint NOT NULL CHECK(independent_support >= 0), outcome_strata jsonb NOT NULL, PRIMARY KEY(snapshot_id, key)
);
CREATE TABLE prediction_confusion (
  id text PRIMARY KEY, run_id text NOT NULL REFERENCES run_manifest(id), predicted_class text NOT NULL,
  observed_class text NOT NULL, failure_cause text NOT NULL, supporting_events jsonb NOT NULL
);
CREATE TABLE snapshot_prediction_error (
  snapshot_id text NOT NULL REFERENCES repository_snapshot(id), key text NOT NULL,
  tool text NOT NULL, observations bigint NOT NULL CHECK(observations > 0),
  errors bigint NOT NULL CHECK(errors >= 0 AND errors <= observations),
  source_episode_ids jsonb NOT NULL, details jsonb NOT NULL, PRIMARY KEY(snapshot_id, key)
);
CREATE TABLE outcome_verdict (
  run_id text PRIMARY KEY REFERENCES run_manifest(id), verifier_version text NOT NULL,
  requested_objective jsonb NOT NULL, inferred_objectives jsonb NOT NULL, achieved_outcomes jsonb NOT NULL,
  independent_verdict jsonb NOT NULL, finalized_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE feedback_application (
  idempotency_key text PRIMARY KEY, run_id text NOT NULL REFERENCES outcome_verdict(run_id),
  target_snapshot_id text NOT NULL REFERENCES repository_snapshot(id), affected_stats jsonb NOT NULL, status text NOT NULL
);
CREATE TABLE checkpoint_intervention (
  id text PRIMARY KEY, episode_id text NOT NULL REFERENCES episode(id), checkpoint bigint NOT NULL,
  treatment text NOT NULL, propensity double precision NOT NULL CHECK(propensity > 0 AND propensity <= 1),
  budgets jsonb NOT NULL, paired_outcome jsonb NOT NULL
);
CREATE TABLE budget_reservation (
  id text PRIMARY KEY, allocation text NOT NULL, maximum_microdollars bigint NOT NULL CHECK(maximum_microdollars >= 0),
  actual_microdollars bigint CHECK(actual_microdollars >= 0), metadata jsonb NOT NULL
);
CREATE FUNCTION reject_change() RETURNS trigger LANGUAGE plpgsql SET search_path = acephale, public AS $$
BEGIN RAISE EXCEPTION 'Immutable research artifact'; END;
$$;
CREATE TRIGGER execution_event_immutable BEFORE UPDATE OR DELETE ON execution_event FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER verdict_immutable BEFORE UPDATE OR DELETE ON outcome_verdict FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER dataset_immutable BEFORE UPDATE OR DELETE ON dataset_manifest FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER episode_immutable BEFORE UPDATE OR DELETE ON episode FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER family_immutable BEFORE UPDATE OR DELETE ON task_family FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER verification_immutable BEFORE UPDATE OR DELETE ON episode_verification FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER annotation_immutable BEFORE UPDATE OR DELETE ON goal_annotation FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER run_immutable BEFORE UPDATE OR DELETE ON run_manifest FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER frame_immutable BEFORE UPDATE OR DELETE ON execution_frame FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER goals_immutable BEFORE UPDATE OR DELETE ON goal_hypothesis FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER evidence_immutable BEFORE UPDATE OR DELETE ON evidence_observation FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER prediction_immutable BEFORE UPDATE OR DELETE ON prediction_record FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER confusion_immutable BEFORE UPDATE OR DELETE ON prediction_confusion FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE FUNCTION protect_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path = acephale, public AS $$
DECLARE sid text;
BEGIN
  IF TG_TABLE_NAME = 'repository_snapshot' THEN
    IF OLD.publication_state = 'frozen' THEN RAISE EXCEPTION 'Frozen snapshot'; END IF;
  ELSE
    sid := COALESCE(NEW.snapshot_id, OLD.snapshot_id);
    IF EXISTS(SELECT 1 FROM repository_snapshot WHERE id = sid AND publication_state = 'frozen') THEN RAISE EXCEPTION 'Frozen snapshot'; END IF;
    IF TG_OP = 'UPDATE' THEN
      sid := OLD.snapshot_id;
      IF EXISTS(SELECT 1 FROM repository_snapshot WHERE id = sid AND publication_state = 'frozen') THEN RAISE EXCEPTION 'Frozen source snapshot'; END IF;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER snapshot_frozen BEFORE UPDATE OR DELETE ON repository_snapshot FOR EACH ROW EXECUTE FUNCTION protect_snapshot();
CREATE TRIGGER pattern_frozen BEFORE INSERT OR UPDATE OR DELETE ON workflow_pattern FOR EACH ROW EXECUTE FUNCTION protect_snapshot();
CREATE TRIGGER embedding_frozen BEFORE INSERT OR UPDATE OR DELETE ON pattern_embedding FOR EACH ROW EXECUTE FUNCTION protect_snapshot();
CREATE TRIGGER transition_frozen BEFORE INSERT OR UPDATE OR DELETE ON goal_transition_stats FOR EACH ROW EXECUTE FUNCTION protect_snapshot();
CREATE TRIGGER errors_frozen BEFORE INSERT OR UPDATE OR DELETE ON snapshot_prediction_error FOR EACH ROW EXECUTE FUNCTION protect_snapshot();
CREATE TRIGGER members_frozen BEFORE INSERT OR UPDATE OR DELETE ON snapshot_episode FOR EACH ROW EXECUTE FUNCTION protect_snapshot();
CREATE FUNCTION verify_snapshot_publication() RETURNS trigger LANGUAGE plpgsql SET search_path = acephale, public AS $$
BEGIN
  IF NEW.publication_state = 'frozen' THEN
    IF TG_OP = 'INSERT' THEN RAISE EXCEPTION 'Snapshots must be staged before publication'; END IF;
    IF EXISTS(SELECT 1 FROM snapshot_episode m JOIN episode e ON e.id = m.episode_id
      WHERE m.snapshot_id = NEW.id AND (e.split <> 'train' OR e.content_hash <> m.content_hash)) THEN
      RAISE EXCEPTION 'Snapshot contains contaminated or changed episodes';
    END IF;
    IF EXISTS(SELECT 1 FROM workflow_pattern p JOIN episode e ON e.id = p.episode_id
      LEFT JOIN episode_verification v ON v.episode_id = e.id
      LEFT JOIN pattern_embedding b ON b.pattern_id = p.id AND b.snapshot_id = p.snapshot_id
      LEFT JOIN snapshot_episode m ON m.snapshot_id = p.snapshot_id AND m.episode_id = e.id
      WHERE p.snapshot_id = NEW.id AND (e.split <> 'train' OR p.verification_tier <> 'native_verified'
        OR e.verification_tier <> 'native_verified' OR v.episode_id IS NULL OR b.pattern_id IS NULL OR m.episode_id IS NULL
        OR p.environment_version <> e.environment_version OR p.tool_schema_hash <> e.tool_schema_hash
        OR (p.payload->>'id') IS DISTINCT FROM p.id OR (p.payload->>'snapshotId') IS DISTINCT FROM p.snapshot_id
        OR (p.payload->>'verificationTier') IS DISTINCT FROM p.verification_tier
        OR (p.payload->'scope'->>'tenantId') IS DISTINCT FROM p.tenant_id OR (p.payload->'scope'->>'principalId') IS DISTINCT FROM p.principal_id
        OR (p.payload->'scope'->>'authorizationVersion') IS DISTINCT FROM p.authorization_version
        OR (p.payload->'scope'->>'environmentVersion') IS DISTINCT FROM p.environment_version
        OR (p.payload->'scope'->>'toolSchemaHash') IS DISTINCT FROM p.tool_schema_hash)) THEN
      RAISE EXCEPTION 'Snapshot pattern lacks native verification, embedding or matching scope';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER publication_valid BEFORE INSERT OR UPDATE ON repository_snapshot FOR EACH ROW EXECUTE FUNCTION verify_snapshot_publication();
COMMIT;
