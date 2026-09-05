FROM node:20-alpine AS builder

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json ./packages/shared/
COPY packages/shared/src ./packages/shared/src
COPY apps/chaos-web/package.json apps/chaos-web/tsconfig.json ./apps/chaos-web/
COPY apps/chaos-web/src ./apps/chaos-web/src

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @chaos/shared build
RUN pnpm --filter @chaos/chaos-web build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@11.25.0 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY apps/chaos-web/package.json ./apps/chaos-web/
COPY --from=builder /app/apps/chaos-web/dist ./apps/chaos-web/dist
COPY apps/chaos-web/public ./apps/chaos-web/public

RUN pnpm install --prod --frozen-lockfile

EXPOSE 3000
CMD ["node", "apps/chaos-web/dist/index.js"]
