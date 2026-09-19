# Stage 1: Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root workspace and package manifests
COPY package*.json tsconfig.base.json ./
COPY packages/protocol/package.json ./packages/protocol/
COPY packages/server/package.json ./packages/server/
COPY packages/client/package.json ./packages/client/
COPY bench/package.json ./bench/

# Install dependencies including devDependencies for compilation
RUN npm install

# Copy source trees
COPY packages/protocol ./packages/protocol
COPY packages/client ./packages/client
COPY packages/server ./packages/server
COPY bench ./bench

# Build all packages
RUN npm run --workspace=@collab/protocol build
RUN npm run --workspace=@collab/client build
RUN npm run --workspace=@collab/server build

# Prune development dependencies
RUN npm prune --omit=dev

# Stage 2: Minimal Production Runtime
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
ENV HOST=0.0.0.0

# Copy node_modules and built artifacts
COPY --chown=node:node package*.json ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/packages/protocol/dist ./packages/protocol/dist
COPY --chown=node:node --from=builder /app/packages/protocol/package.json ./packages/protocol/package.json
COPY --chown=node:node --from=builder /app/packages/server/dist ./packages/server/dist
COPY --chown=node:node --from=builder /app/packages/server/package.json ./packages/server/package.json
COPY --chown=node:node --from=builder /app/packages/client/dist ./packages/client/dist
COPY --chown=node:node --from=builder /app/packages/client/package.json ./packages/client/package.json

USER node

EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/healthz || exit 1

CMD ["node", "packages/server/dist/index.js"]
