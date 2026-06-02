# Stage 1: Build
FROM node:22-slim AS builder

WORKDIR /app

# Copy workspace root files
COPY package.json package-lock.json tsconfig.json ./
COPY projects/api/package.json projects/api/tsconfig.json ./projects/api/
COPY projects/api/prisma ./projects/api/prisma/
COPY projects/api/prisma.config.ts ./projects/api/prisma.config.ts
COPY projects/shared/package.json projects/shared/tsconfig.json ./projects/shared/
COPY projects/shared/src ./projects/shared/src/
COPY projects/tap/package.json projects/tap/tsconfig.json ./projects/tap/
COPY projects/tap/src ./projects/tap/src/
COPY projects/mini-app/package.json projects/mini-app/tsconfig.json projects/mini-app/tsconfig.app.json projects/mini-app/tsconfig.node.json ./projects/mini-app/
COPY projects/mini-app/index.html projects/mini-app/vite.config.ts ./projects/mini-app/
COPY projects/mini-app/src ./projects/mini-app/src/
COPY projects/mini-app/public ./projects/mini-app/public/

# Install all dependencies (including devDependencies for build)
RUN npm ci --workspace=projects/api --workspace=projects/shared --workspace=projects/tap --workspace=projects/mini-app --include-workspace-root

# Build shared package
WORKDIR /app/projects/shared
RUN npx tsc

# Build tap package
WORKDIR /app/projects/tap
RUN npx tsc

# Build mini-app
WORKDIR /app/projects/mini-app
RUN npm run build

# Generate Prisma client
WORKDIR /app/projects/api
RUN npx prisma generate

# Copy source and build
COPY projects/api/src ./src/
RUN npx tsc

# Stage 2: Production
FROM node:22-slim AS runner

WORKDIR /app

# Copy workspace root files
COPY package.json package-lock.json ./
COPY projects/api/package.json ./projects/api/
COPY projects/shared/package.json ./projects/shared/
COPY projects/tap/package.json ./projects/tap/
COPY --from=builder /app/projects/shared/dist ./projects/shared/dist/
COPY --from=builder /app/projects/tap/dist ./projects/tap/dist/

# Install production dependencies only
RUN npm ci --workspace=projects/api --workspace=projects/shared --workspace=projects/tap --include-workspace-root --omit=dev

# Copy built output (includes generated Prisma client in dist/generated/)
COPY --from=builder /app/projects/api/dist ./projects/api/dist/
COPY --from=builder /app/projects/api/prisma ./projects/api/prisma/
COPY --from=builder /app/projects/mini-app/dist ./projects/mini-app/dist/

WORKDIR /app/projects/api

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/main.js"]
