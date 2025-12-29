# Multi-stage build optimized for pnpm fetch (better Docker layer caching)

FROM node:24-slim AS base

# Create non-root user with explicit IDs and install SSL certificates
RUN groupadd -g 1001 nonroot && \
    useradd -u 1001 -g nonroot -s /bin/bash -m nonroot && \
    apt-get update && \
    apt-get install --no-install-recommends -y \
    build-essential \
    ca-certificates \
    curl \
    git \
    openssl && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* && \
    update-ca-certificates && \
    mkdir -p /app /pnpm/store && \
    chown 1001:1001 /app /pnpm /pnpm/store

WORKDIR /app

# Enable Corepack shims as root (required because it writes to /usr/local/bin)
RUN corepack enable

# Keep pnpm store in a deterministic location so we can copy it across stages
ENV PNPM_HOME=/pnpm
ENV PNPM_STORE_DIR=/pnpm/store
ENV PATH=${PNPM_HOME}:${PATH}

# Disable git hooks during container builds
ENV HUSKY=0

# Switch to non-root user
USER 1001:1001


FROM base AS deps

# Only copy manifests first
COPY --chown=1001:1001 package.json pnpm-lock.yaml .npmrc ./

# Prefetch production dependencies into the store
RUN pnpm fetch --prod


FROM base AS runner

# Reuse the fetched store for an offline install
COPY --from=deps --chown=1001:1001 /pnpm/store /pnpm/store

COPY --chown=1001:1001 package.json pnpm-lock.yaml .npmrc ./

RUN pnpm install --prod --offline --frozen-lockfile

# Copy source code (including templates needed for PR review prompts)
COPY --chown=1001:1001 src/ src/
COPY --chown=1001:1001 templates/ templates/
COPY --chown=1001:1001 .revuignore .revuignore

# Create repository directory for cloning with appropriate permissions
RUN mkdir -p /app/repos && \
    chmod u+w /app/repos && \
    git config --global http.sslverify true && \
    git config --global http.sslcainfo /etc/ssl/certs/ca-certificates.crt

# Set environment variables for server configuration
ENV HOST=0.0.0.0
ENV PORT=3000
ENV GIT_SSL_CAINFO=/etc/ssl/certs/ca-certificates.crt

# Expose port for webhook server
EXPOSE 3000

CMD ["pnpm", "start"]
