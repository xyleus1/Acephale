# Prisma Guidance

- Preserve tenant isolation. New tenant-owned models and queries need `officeId` and appropriate indexes.
- Treat schema changes as high-risk: update `prisma/schema.prisma`, add migrations when required, and avoid destructive changes unless explicitly requested.
- Run `npx prisma validate` and `npm run db:generate` after schema edits.
- Do not run `prisma db push`, migrations, or resets against production-like databases without explicit approval.
- Do not store plaintext secrets, tokens, OAuth credentials, or private keys in schema defaults, seed data, or migrations.
- Keep migrations auditable and focused. Do not mix unrelated schema cleanup into feature work.
