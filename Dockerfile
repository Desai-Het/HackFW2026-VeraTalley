# VeraTalley web app (Next.js) - production image.
# Build from the repository root:  docker build -t veratalley .
#
# NEXT_PUBLIC_* values are baked into the browser code at BUILD time, so they are build
# arguments. Changing any of them means rebuilding the image. Secrets (RELAYER_PRIVATE_KEY,
# INVITE_SECRET, RESEND_API_KEY) are NOT build arguments; they are passed when the container runs.

FROM node:22-bookworm-slim AS build
WORKDIR /app

# Install only the frontend's dependencies (the repo is an npm workspace with one root lockfile).
COPY package.json package-lock.json ./
COPY contracts/package.json contracts/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --workspace=frontend --include-workspace-root=false

COPY frontend ./frontend

ARG NEXT_PUBLIC_ELECTION_FACTORY_ADDRESS
ARG NEXT_PUBLIC_CHAIN_ID=80002
ARG NEXT_PUBLIC_RPC_URL
ARG NEXT_PUBLIC_EXPLORER_URL
ARG NEXT_PUBLIC_ORGANISER_WALLETS
ARG NEXT_PUBLIC_VOTER_REGISTRY_ADDRESS=0x0000000000000000000000000000000000000001
ARG NEXT_PUBLIC_ELECTION_BALLOT_ADDRESS=0x0000000000000000000000000000000000000002
ENV NEXT_PUBLIC_ELECTION_FACTORY_ADDRESS=$NEXT_PUBLIC_ELECTION_FACTORY_ADDRESS \
    NEXT_PUBLIC_CHAIN_ID=$NEXT_PUBLIC_CHAIN_ID \
    NEXT_PUBLIC_RPC_URL=$NEXT_PUBLIC_RPC_URL \
    NEXT_PUBLIC_EXPLORER_URL=$NEXT_PUBLIC_EXPLORER_URL \
    NEXT_PUBLIC_ORGANISER_WALLETS=$NEXT_PUBLIC_ORGANISER_WALLETS \
    NEXT_PUBLIC_VOTER_REGISTRY_ADDRESS=$NEXT_PUBLIC_VOTER_REGISTRY_ADDRESS \
    NEXT_PUBLIC_ELECTION_BALLOT_ADDRESS=$NEXT_PUBLIC_ELECTION_BALLOT_ADDRESS \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace=frontend

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/frontend ./frontend
# Registrations live in /data (mount a NAS folder here). The Next cache must be writable too,
# because the container may run as an ordinary NAS user rather than root.
RUN mkdir -p /data /app/frontend/.next/cache && chmod -R a+rwX /data /app/frontend/.next/cache
WORKDIR /app/frontend
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "../node_modules/next/dist/bin/next", "start", "-p", "3000"]
