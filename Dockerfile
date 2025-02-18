# Single stage build
FROM node:23.7.0-slim

# Create non-root user with explicit IDs
RUN groupadd -g 1001 nonroot && \
    useradd -u 1001 -g nonroot -s /bin/bash -m nonroot

# Install git and other dependencies
RUN apt-get update && \
    apt-get install -y \
    git \
    curl \
    build-essential && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create app directory and set ownership
WORKDIR /app
RUN chown 1001:1001 /app

# Switch to non-root user
USER 1001:1001

# Copy package files
COPY --chown=1001:1001 package.json yarn.lock ./

# Install dependencies
RUN yarn install

# Copy source code
COPY --chown=1001:1001 . .

# Copy templates (needed for PR review prompts)
COPY --chown=1001:1001 templates ./templates

# Create repository directory for cloning with appropriate permissions
RUN mkdir -p /app/repos && chmod 755 /app/repos

# Expose port for webhook server
EXPOSE 3000

# Start the bot using TypeScript directly
CMD ["node", "src/index.ts"]
