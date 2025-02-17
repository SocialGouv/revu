# Build stage
FROM node:23.7.0-slim AS builder

# Create app directory
WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install

# Copy source code
COPY . .

# Build TypeScript code
RUN yarn build

# Production stage
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

# Install production dependencies only
RUN yarn install --production

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist

# Copy templates (needed for PR review prompts)
COPY templates ./templates

# Create repository directory for cloning
RUN mkdir -p /app/repos && chmod 777 /app/repos

# Expose port for webhook server
EXPOSE 3000

# Start the bot
CMD ["yarn", "start"]
