# Multi-stage production Dockerfile for Collaborative Whiteboard
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Dependencies stage
FROM base AS dependencies
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/sim/package.json ./packages/sim/
RUN pnpm install --frozen-lockfile

# Build stage
FROM dependencies AS builder
COPY . .
RUN pnpm -r build

# Production runtime stage
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=dependencies /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/server/package.json ./apps/server/package.json
COPY --from=builder /app/apps/server/migrations ./apps/server/migrations

EXPOSE 8080

CMD ["node", "apps/server/dist/main.js"]
