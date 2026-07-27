# Multi-stage build for a Pulse service (collector or mcp). Pass SERVICE as a build arg.
#   docker build -f deploy/Dockerfile --build-arg SERVICE=collector -t pulse-collector .
#   docker build -f deploy/Dockerfile --build-arg SERVICE=mcp       -t pulse-mcp .
#
# We use `pnpm deploy` (with inject-workspace-packages=true in .npmrc) to produce a self-contained
# bundle for one package: its @pulse/* workspace deps are materialized as real packages, not symlinks
# to source. A plain `COPY` + `pnpm prune` leaves the workspace symlinks dangling in the runtime image
# and Node fails with ERR_MODULE_NOT_FOUND on @pulse/core.

FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
# CI=true so pnpm runs non-interactively (no TTY in a Docker build).
ENV CI=true
# Copy the whole workspace and install against the lockfile.
COPY . .
RUN pnpm install --frozen-lockfile
# `tsc --build` compiles every package to its dist/ (composite project references).
RUN pnpm run typecheck
# Bundle just the requested service into /deploy, with @pulse/* deps injected and dev deps dropped.
# The deployed layout is flat: entrypoint ends up at /deploy/dist/main.js.
ARG SERVICE
RUN pnpm --filter "@pulse/${SERVICE}" deploy --prod /deploy

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /deploy ./
# `pnpm deploy` flattens the package to the root: the compiled entrypoint is dist/main.js.
CMD ["node", "dist/main.js"]
