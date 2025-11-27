# Single stage build
FROM node:24-slim

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
    # Create app directory and set ownership
    mkdir -p /app && \
    chown 1001:1001 /app

WORKDIR /app

# Switch to non-root user
USER 1001:1001


# Copy dependencies and Yarn configuration FIRST for better Docker caching
COPY --chown=1001:1001 package.json yarn.lock .yarnrc.yml ./
COPY --chown=1001:1001 .yarn .yarn

# Install dependencies
RUN yarn install --immutable

# Copy source code (including templates needed for PR review prompts)
COPY --chown=1001:1001 src/ src/
COPY --chown=1001:1001 templates/ templates/
COPY --chown=1001:1001 .revuignore .revuignore

# Create repository directory for cloning with appropriate permissions
RUN mkdir -p /app/repos && \
    chmod u+w /app/repos && \
    # Configure git for SSL certificate verification
    git config --global http.sslverify true && \
    git config --global http.sslcainfo /etc/ssl/certs/ca-certificates.crt

# Set environment variables for server configuration
ENV HOST=0.0.0.0
ENV PORT=3000
ENV GIT_SSL_CAINFO=/etc/ssl/certs/ca-certificates.crt

# Expose port for webhook server
EXPOSE 3000

# Start the bot using TypeScript directly
# CMD ["node", "src/index.ts"]
CMD ["yarn", "start"]
