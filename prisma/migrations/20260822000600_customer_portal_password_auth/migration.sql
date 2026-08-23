BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE "CustomerPortalUser"
  ADD COLUMN "passwordHash" TEXT,
  ADD COLUMN "passwordVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "passwordUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastFailedLoginAt" TIMESTAMP(3),
  ADD COLUMN "lockedUntil" TIMESTAMP(3);

ALTER TABLE "CustomerPortalUser"
  ADD CONSTRAINT "CustomerPortalUser_password_state_check"
  CHECK (
    "passwordVersion" >= 0
    AND "failedLoginAttempts" >= 0
    AND (
      ("passwordHash" IS NULL AND "passwordUpdatedAt" IS NULL)
      OR ("passwordHash" IS NOT NULL AND "passwordUpdatedAt" IS NOT NULL)
    )
  );

CREATE TABLE "CustomerPortalLoginThrottle" (
  "keyHash" TEXT NOT NULL,
  "windowStartedAt" TIMESTAMP(3) NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomerPortalLoginThrottle_pkey" PRIMARY KEY ("keyHash"),
  CONSTRAINT "CustomerPortalLoginThrottle_attempt_count_check" CHECK ("attemptCount" >= 0)
);

CREATE INDEX "CustomerPortalLoginThrottle_expiresAt_idx"
  ON "CustomerPortalLoginThrottle"("expiresAt");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'derya_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE "CustomerPortalLoginThrottle"
      TO derya_app;
  END IF;
END
$$;

COMMIT;
