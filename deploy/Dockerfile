# Multi-stage build for a Pulse service (collector or mcp). Pass SERVICE as a build arg.
#   docker build -f deploy/Dockerfile --build-arg SERVICE=collector -t pulse-collector .
#   docker build -f deploy/Dockerfile --build-arg SERVICE=mcp       -t pulse-mcp .

FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
# Copy the whole workspace and install against the lockfile.
COPY . .
RUN pnpm install --frozen-lockfile
# `tsc --build` compiles every package to its dist/ (composite project references).
RUN pnpm run typecheck
# Drop dev dependencies; dist/ and migrations/ stay.
RUN pnpm prune --prod

FROM node:22-slim AS runtime
WORKDIR /app
ARG SERVICE
ENV NODE_ENV=production
ENV PULSE_SERVICE=${SERVICE}
COPY --from=build /app ./
# Each service's compiled entrypoint is packages/<service>/dist/main.js.
CMD ["sh", "-c", "node packages/${PULSE_SERVICE}/dist/main.js"]
