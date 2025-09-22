# Single stage build
FROM node:24-slim

# Create non-root user with explicit IDs
RUN groupadd -g 1001 nonroot && \
    useradd -u 1001 -g nonroot -s /bin/bash -m nonroot && \
    apt-get update && \
    apt-get install --no-install-recommends -y \
    build-essential \
    curl \
    git && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create app directory and set ownership
RUN mkdir -p /app && \
    chown 1001:1001 /app
WORKDIR /app

# Switch to non-root user
USER 1001:1001


# Copy dependencies and Yarn configuration, including the .yarn directory
COPY --chown=1001:1001 yarn.lock .yarnrc.yml ./
COPY --chown=1001:1001 .yarn .yarn

# Copy package.json after fetching dependencies
COPY --chown=1001:1001 package.json ./

# Install dependencies
RUN yarn fetch workspaces focus --production

# Copy source code (including templates needed for PR review prompts)
COPY --chmod=444 src/ src/
COPY --chmod=444 templates/ templates/

# Create repository directory for cloning with appropriate permissions
RUN mkdir -p /app/repos && \
    chmod u+w /app/repos

# Set environment variables for server configuration
ENV HOST=0.0.0.0
ENV PORT=3000

# Expose port for webhook server
EXPOSE 3000

# Start the bot using TypeScript directly
# CMD ["node", "src/index.ts"]
CMD ["yarn", "start"]
