## Deploy Configuration (configured by /setup-deploy)

- Platform: Vercel
- Production URL: https://app.derya.ai
- Deploy workflow: auto-deploy on push to main
- Deploy status command: HTTP health check
- Merge method: squash
- Project type: web app and API
- Post-deploy health check: https://app.derya.ai/api/health

### Custom deploy hooks

- Pre-merge: run the relevant repository contracts and confirm required production migrations are applied
- Deploy trigger: automatic on push to main
- Deploy status: poll the Vercel deployment and production health endpoint
- Health check: https://app.derya.ai/api/health

### Production database migrations

- Routine Vercel builds never run database migrations.
- Dispatch `.github/workflows/production-database-migration.yml` from `main`.
- Supply the latest committed migration directory and the exact confirmation phrase.
- The workflow uses the `Production` environment owner secret, verifies the exact database and role, runs Prisma migration deployment, and requires a committed read-only verification script.
