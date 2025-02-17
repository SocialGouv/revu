# Revu - AI-Powered PR Reviews

Revu is a GitHub App that provides automated code reviews for pull requests using Anthropic's Claude API. It analyzes the codebase, PR changes, and repository history to provide insightful feedback.

## Prerequisites

- Node.js v23.7.0 (use nvm to manage Node versions)
- A GitHub account with permissions to create GitHub Apps
- An Anthropic API key

## Installation

1. Clone the repository
2. Install dependencies:
```bash
nvm use v23.7.0
yarn install
```

## GitHub App Setup

1. Go to your GitHub account Settings > Developer settings > GitHub Apps
2. Click "New GitHub App"
3. Fill in the following details:
   - **Name**: Your app name (e.g., "Revu")
   - **Homepage URL**: Your app's homepage or repository URL
   - **Webhook URL**: Your app's webhook URL (use [smee.io](https://smee.io) for local development)
   - **Webhook secret**: Generate a random string
   - **Repository permissions**:
     - **Pull requests**: Read & write (to post review comments)
     - **Contents**: Read (to access repository content)
   - **Subscribe to events**:
     - Pull request
4. Generate and download a private key
5. Note down the App ID

## Environment Variables

Copy `.env.example` to `.env` and fill in the following variables:

```env
# Anthropic API Key
ANTHROPIC_API_KEY=your_api_key

# GitHub App Configuration
APP_ID=your_app_id
PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nyour_private_key\n-----END RSA PRIVATE KEY-----"
WEBHOOK_SECRET=your_webhook_secret

# Optional: Webhook Proxy URL for local development
WEBHOOK_PROXY_URL=https://smee.io/your-smee-url

# App Configuration
REPOSITORY_FOLDER=/path/to/repos
```

## Development

1. Start the webhook proxy (for local development):
```bash
npm install -g smee-client
smee -u https://smee.io/your-smee-url -t http://localhost:3000/api/github/webhooks
```

2. Run the app in development mode:
```bash
nvm use v23.7.0
yarn dev
```

## Deployment

### Local Production

1. Build the app:
```bash
nvm use v23.7.0
yarn build
```

2. Start the app:
```bash
yarn start
```

### Docker Deployment

1. Build the Docker image:
```bash
docker build -t revu .
```

2. Run the container:
```bash
docker run -d \
  -p 3000:3000 \
  --env-file .env \
  -v /path/to/local/repos:/app/repos \
  revu
```

Note: Replace `/path/to/local/repos` with the path where you want the repositories to be cloned.

## How It Works

1. When a PR is opened or updated, the app:
   - Extracts the repository codebase
   - Gets the PR diff
   - Retrieves relevant git logs
2. This information is used to create a prompt for Claude
3. Claude analyzes the changes and provides feedback
4. The feedback is posted as a comment on the PR

## License

Private - All rights reserved
