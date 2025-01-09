# Build stage
FROM node:18-slim AS builder

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build TypeScript code
RUN npm run build

# Production stage
FROM node:18-slim

# Install git (needed for cloning repositories)
RUN apt-get update && \
    apt-get install -y git && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist

# Copy templates (needed for PR review prompts)
COPY templates ./templates

# Create repository directory for cloning
RUN mkdir -p /app/repos && chmod 777 /app/repos

# Expose port for webhook server
EXPOSE 3000

# Start the bot
CMD ["npm", "start"]
