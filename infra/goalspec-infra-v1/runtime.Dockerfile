ARG NODE_IMAGE
FROM ${NODE_IMAGE}
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY prisma/schema.prisma ./prisma/schema.prisma
# Generate the research raw-query client without application credentials or DB access.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/goalspec_build DATABASE_URL_UNPOOLED=postgresql://build:build@127.0.0.1:5432/goalspec_build npx --no-install prisma generate --schema prisma/schema.prisma
COPY tsconfig.json tsconfig.goalspec.json ./
COPY src ./src
COPY services ./services
COPY scripts ./scripts
COPY research/goalspec/benchmarks.lock.json research/goalspec/benchmarks.lock.json
COPY infra/goalspec-infra-v1/compose.json infra/goalspec-infra-v1/compose.json
USER node
ENTRYPOINT ["node", "--import", "tsx", "scripts/goalspec-infra-run.ts"]
CMD ["serve"]
