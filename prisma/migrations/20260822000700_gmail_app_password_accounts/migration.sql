ALTER TABLE "EmailAccount"
ADD COLUMN "displayName" TEXT,
ADD COLUMN "credentialSecret" TEXT;

ALTER TABLE "EmailMessage"
ADD COLUMN "rfcMessageId" TEXT;

COMMENT ON COLUMN "EmailAccount"."credentialSecret" IS
'AES-256-GCM encrypted provider credential. Never store or return plaintext.';
