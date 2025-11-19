# Installation Guide

[🏠 Home](../README.md) | [⚙️ Configuration](CONFIGURATION.md)

## Prerequisites

Before installing, ensure you have the following installed:

- **Language**: Node.js version 24 or higher
- **Package Manager**: Yarn version 4.10.0 (specified in packageManager field)
- **Other Tools**: 
  - Git (required for repository cloning)
  - For Docker installation: Docker and Docker Compose

## Installation Steps

### 1. Clone the Repository

```bash
git clone https://github.com/SocialGouv/revu.git
cd revu
```

### 2. Install Dependencies

```bash
# Using yarn (recommended - version 4.10.0)
yarn install

# Note: Yarn v4 is included in the repository (.yarn/releases/yarn-4.10.0.cjs)
# so you don't need to install it globally
```

### 3. Environment Setup

Create a `.env` file from the example:

```bash
cp .env.example .env
```

See [Configuration Guide](CONFIGURATION.md) for details on setting up environment variables.

**Required environment variables** include:
- `ANTHROPIC_API_KEY` - Your Anthropic API key for Claude
- `APP_ID` - GitHub App ID
- `PRIVATE_KEY_PATH` or `PRIVATE_KEY` - GitHub App private key
- `WEBHOOK_SECRET` - GitHub webhook secret

### 4. Build

This project uses TypeScript with `tsx` for runtime execution, so no separate build step is required. The application runs directly from TypeScript source files.

## Verification

Verify the installation by running:

```bash
# Run tests
yarn test

# For test coverage
yarn test:coverage

# Type checking
yarn typecheck

# Start the application
yarn start

# Or use development mode
yarn dev
```

You should see output similar to:
```
🤖 Revu server listening on 0.0.0.0:3000
```

The server will be available at `http://localhost:3000` with the following endpoints:
- `/api/github/webhooks` - GitHub webhook endpoint
- `/healthz` - Health check endpoint (returns "OK")

### CLI Usage

You can also use the CLI to review pull requests manually:

```bash
# Review a PR (dry-run mode - displays analysis without submitting)
yarn review-pr https://github.com/owner/repo/pull/123

# Review a PR and submit comments to GitHub
yarn review-pr https://github.com/owner/repo/pull/123 --submit
```

## Docker Installation

### Using Docker

```bash
# Build the Docker image
docker build -t revu .

# Run the container
docker run -p 3000:3000 --env-file .env revu
```

### Using Docker Compose

```bash
# Start the service
docker-compose up

# Run in detached mode
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the service
docker-compose down
```

The Docker Compose setup includes:
- Port mapping: `3000:3000`
- Environment variables loaded from `.env` file
- Volume mounts for source code and repositories
- Health check endpoint at `/healthz`
- Automatic restart policy

## Next Steps

After installation, proceed to:

- [⚙️ Configuration Guide](CONFIGURATION.md) - Configure the application
