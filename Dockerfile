# Single stage build
FROM node:23.7.0-slim

# Install git and other dependencies
RUN apt-get update && \
    apt-get install -y \
    git \
    curl \
    build-essential && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install

# Copy source code
COPY . .

# Copy templates (needed for PR review prompts)
COPY templates ./templates

# Create repository directory for cloning
RUN mkdir -p /app/repos && chmod 777 /app/repos

# Expose port for webhook server
EXPOSE 3000

# Start the bot using TypeScript directly
CMD ["node", "src/index.ts"]
