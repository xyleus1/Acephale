ARG NODE_IMAGE
FROM ${NODE_IMAGE}
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json tsconfig.acephale.json ./
COPY src ./src
COPY services ./services
COPY scripts ./scripts
COPY research/acephale/benchmarks.lock.json research/acephale/benchmarks.lock.json
COPY infra/acephale-infra-v1/compose.json infra/acephale-infra-v1/compose.json
USER node
ENTRYPOINT ["node", "--import", "tsx", "scripts/acephale-infra-run.ts"]
CMD ["serve"]
