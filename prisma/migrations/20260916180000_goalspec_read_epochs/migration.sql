-- Internal freshness counters, never business evidence or actor context.
-- Application production reuse remains disabled until separately proven.
BEGIN;
CREATE SCHEMA goalspec_read_guard;
REVOKE ALL ON SCHEMA goalspec_read_guard FROM PUBLIC;
CREATE TABLE goalspec_read_guard.epochs (
  table_name text PRIMARY KEY,
  epoch bigint NOT NULL DEFAULT 0 CHECK (epoch >= 0)
);
CREATE TABLE goalspec_read_guard.metadata (
  id integer PRIMARY KEY CHECK (id = 1),
  incarnation uuid NOT NULL DEFAULT gen_random_uuid(),
  contract text NOT NULL,
  coverage jsonb NOT NULL
);
REVOKE ALL ON ALL TABLES IN SCHEMA goalspec_read_guard FROM PUBLIC;

CREATE FUNCTION goalspec_read_guard.bump() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  -- Transactional row update, not a sequence: rollback must undo the counter.
  -- Every statement is covered, including zero-row statements, COPY, raw SQL,
  -- FK cascades and TRUNCATE. Coarse counters deliberately over-invalidate.
  UPDATE goalspec_read_guard.epochs SET epoch = epoch + 1 WHERE table_name = TG_TABLE_NAME;
  IF NOT FOUND THEN RAISE EXCEPTION 'GoalSpec epoch coverage missing'; END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION goalspec_read_guard.bump() FROM PUBLIC;

DO $$
DECLARE table_name text; table_oid oid; inventory jsonb := '{}'::jsonb;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['User','Job','Company','Inquiry','CarrierQuote','EmailThread','EmailMessage','JobMilestone','JobDocument'] LOOP
    table_oid := to_regclass(format('public.%I', table_name));
    IF table_oid IS NULL OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = table_oid AND relkind = 'r' AND NOT relispartition)
       OR EXISTS (SELECT 1 FROM pg_inherits WHERE inhrelid = table_oid OR inhparent = table_oid) THEN
      RAISE EXCEPTION 'GoalSpec epoch coverage requires an ordinary unpartitioned table: %', table_name;
    END IF;
    INSERT INTO goalspec_read_guard.epochs(table_name) VALUES(table_name);
    EXECUTE format('CREATE TRIGGER goalspec_read_epoch_v1 AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION goalspec_read_guard.bump()', table_name);
    -- Default deployments incur no counter writes. Explicit owner activation
    -- for shadow research is separate from enabling observation reuse.
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER goalspec_read_epoch_v1', table_name);
    SELECT inventory || jsonb_build_object(table_name, jsonb_build_object(
      'tableOid', c.oid::text, 'triggerOid', t.oid::text, 'trigger', pg_get_triggerdef(t.oid), 'function', pg_get_functiondef(p.oid)))
    INTO inventory FROM pg_class c JOIN pg_trigger t ON t.tgrelid = c.oid
      JOIN pg_proc p ON p.oid = t.tgfoid WHERE c.oid = table_oid AND t.tgname = 'goalspec_read_epoch_v1';
  END LOOP;
  INSERT INTO goalspec_read_guard.metadata(id, contract, coverage) VALUES (1, 'derya-table-epochs-v1', inventory);
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'derya_app') THEN
    GRANT USAGE ON SCHEMA goalspec_read_guard TO derya_app;
    GRANT SELECT ON ALL TABLES IN SCHEMA goalspec_read_guard TO derya_app;
  END IF;
END;
$$;
-- Restore/reset operators must rotate incarnation and regenerate coverage after
-- restore. A new deployment/role/partition layout requires new proof. The live
-- reader refuses reuse on any catalog, role, incarnation or contract mismatch.
-- Audited shadow activation: scripts/sql/goalspec-enable-epoch-shadow.sql.
COMMIT;
