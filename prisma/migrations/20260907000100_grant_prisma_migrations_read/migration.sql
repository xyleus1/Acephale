DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'derya_app')
     AND to_regclass('public._prisma_migrations') IS NOT NULL THEN
    GRANT SELECT ON TABLE public._prisma_migrations TO derya_app;
  END IF;
END $$;
