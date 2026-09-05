FROM node:20-alpine AS builder

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json ./packages/shared/
COPY packages/shared/src ./packages/shared/src
COPY apps/checkout/package.json apps/checkout/tsconfig.json ./apps/checkout/
COPY apps/checkout/src ./apps/checkout/src

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @chaos/shared build
RUN pnpm --filter @chaos/checkout build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@11.25.0 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY apps/checkout/package.json ./apps/checkout/
COPY --from=builder /app/apps/checkout/dist ./apps/checkout/dist

RUN pnpm install --prod --frozen-lockfile

EXPOSE 3001
CMD ["node", "apps/checkout/dist/index.js"]
