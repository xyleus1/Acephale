BEGIN;

DO $$
BEGIN
  IF to_regclass('public."OrderSupplier"') IS NULL
    OR to_regclass('public.order_vendors') IS NULL THEN
    RAISE EXCEPTION 'OrderSupplier compatibility schema is incomplete';
  END IF;
END
$$;

-- The RFQ send stamps the message it sent and the thread it opened on the
-- supplier row, and every later pass reads those to reply on the same thread
-- and to tell a contacted supplier from an unmailed one. The live Bourne table
-- already carries both, so this only brings the declared schema in line with
-- what the application writes.
ALTER TABLE "OrderSupplier"
  ADD COLUMN IF NOT EXISTS last_email_message_id TEXT,
  ADD COLUMN IF NOT EXISTS email_thread_id TEXT;

-- A view built from SELECT * keeps the column list it was created with, so the
-- compatibility view is replaced to expose the appended columns.
CREATE OR REPLACE VIEW order_vendors AS
SELECT * FROM "OrderSupplier";

COMMIT;
