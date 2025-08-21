# Single stage build
FROM node:23.11.0-slim

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

# Copy package files and Yarn configuration, including the .yarn directory
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn .yarn/

# Setup permissions
RUN chmod -R 755 .yarn && \
    chown -R 1001:1001 /app

# Switch to non-root user
USER 1001:1001

# Install dependencies
RUN yarn install

# Copy source code (including templates needed for PR review prompts)
COPY --chown=1001:1001 . .

# Create repository directory for cloning with appropriate permissions
RUN mkdir -p /app/repos && chmod 755 /app/repos

# Set environment variables for server configuration
ENV HOST=0.0.0.0
ENV PORT=3000

# Expose port for webhook server
EXPOSE 3000

# Start the bot using TypeScript directly
# CMD ["node", "src/index.ts"]
CMD ["yarn", "start"]
