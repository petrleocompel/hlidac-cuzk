# syntax=docker/dockerfile:1
# The frontend/server bundle is architecture independent; dependency installs are not.
FROM --platform=$BUILDPLATFORM node:26-alpine AS build-base
# Node 25+ no longer bundles Corepack; install a pinned copy from npm.
ARG COREPACK_VERSION=0.36.0
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_HOME=/opt/corepack
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install --global --no-fund --no-audit corepack@${COREPACK_VERSION} && corepack enable && corepack install

FROM build-base AS deps
RUN --mount=type=cache,id=pnpm-build,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build

FROM node:26-alpine AS runtime-base
# Node 25+ no longer bundles Corepack; install a pinned copy from npm.
ARG COREPACK_VERSION=0.36.0
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_HOME=/opt/corepack
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Download the pinned package manager at build time, never on container startup.
RUN npm install --global --no-fund --no-audit corepack@${COREPACK_VERSION} && corepack enable && corepack install

FROM runtime-base AS production-deps
RUN --mount=type=cache,id=pnpm-production,target=/pnpm/store pnpm install --prod --frozen-lockfile

FROM runtime-base AS runner
ARG APP_VERSION=development
ARG APP_REVISION=unknown
ENV NODE_ENV=production APP_VERSION=$APP_VERSION APP_REVISION=$APP_REVISION
LABEL org.opencontainers.image.version=$APP_VERSION org.opencontainers.image.revision=$APP_REVISION
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/.output ./.output
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json ./
COPY --from=build /app/instrument.server.mjs ./
USER node
EXPOSE 3000
CMD ["pnpm", "start"]
