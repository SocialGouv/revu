# Use Node.js 18 as base image
FROM node:18-slim

# Install git and other dependencies
RUN apt-get update && \
    apt-get install -y git && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install global tools
RUN npm install -g ai-digest code2prompt

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy app source
COPY . .

# Create tmp directory for cloning repositories
RUN mkdir -p tmp && chmod 777 tmp

# Expose port for webhook server
EXPOSE 3000

# Start the bot
CMD ["npm", "start"]
