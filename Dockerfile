# EventForge API - Docker Build
# Build from monorepo root: docker build -t eventforge-api .

# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/api/package*.json ./packages/api/
RUN npm ci
COPY packages/shared/ ./packages/shared/
COPY packages/api/ ./packages/api/
COPY tsconfig.base.json ./
COPY tsconfig.json ./
RUN npx tsc --build packages/shared packages/api

# Stage 2: Production
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/api/package*.json ./packages/api/
RUN npm ci --workspace=packages/shared --workspace=packages/api --omit=dev
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/api/dist ./packages/api/dist
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["node", "packages/api/dist/server.js"]
