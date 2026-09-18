-- Explicit database-owner operation. Never invoked automatically by app code.
-- Enable only for an authorized shadow study: this adds measured writer work.
-- It does not authorize verified observation reuse or create a performance receipt.
BEGIN;
DO $$
DECLARE name text; inventory jsonb := '{}'::jsonb; expected jsonb;
BEGIN
  SELECT coverage INTO STRICT expected FROM goalspec_read_guard.metadata WHERE id = 1 AND contract = 'derya-table-epochs-v1';
  FOREACH name IN ARRAY ARRAY['User','Job','Company','Inquiry','CarrierQuote','EmailThread','EmailMessage','JobMilestone','JobDocument'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass(format('public.%I', name)) AND relkind = 'r' AND NOT relispartition)
      OR EXISTS (SELECT 1 FROM pg_inherits WHERE inhrelid = to_regclass(format('public.%I', name)) OR inhparent = to_regclass(format('public.%I', name))) THEN
      RAISE EXCEPTION 'Unsupported epoch shadow table layout';
    END IF;
    -- DDL locks are retained until all tables and metadata are committed.
    EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER goalspec_read_epoch_v1', name);
    SELECT inventory || jsonb_build_object(name, jsonb_build_object(
      'tableOid', c.oid::text, 'triggerOid', t.oid::text, 'trigger', pg_get_triggerdef(t.oid), 'function', pg_get_functiondef(p.oid)))
    INTO inventory FROM pg_class c JOIN pg_trigger t ON t.tgrelid = c.oid JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE c.oid = to_regclass(format('public.%I', name)) AND t.tgname = 'goalspec_read_epoch_v1';
  END LOOP;
  IF inventory IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Epoch definitions changed; reviewed migration and new proof required'; END IF;
  UPDATE goalspec_read_guard.metadata SET incarnation = gen_random_uuid(), coverage = inventory WHERE id = 1;
END;
$$;
COMMIT;
