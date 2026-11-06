ARG NODE_IMAGE
FROM ${NODE_IMAGE}
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json tsconfig.goalspec.json ./
COPY src ./src
COPY services ./services
COPY scripts ./scripts
COPY research/goalspec/benchmarks.lock.json research/goalspec/benchmarks.lock.json
USER node
ENTRYPOINT ["node", "--import", "tsx", "scripts/goalspec-infra-run.ts"]
CMD ["serve"]
