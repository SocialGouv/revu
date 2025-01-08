# Revu - Automated PR Reviews with Claude

Revu is a GitHub bot that automatically generates high-quality pull request reviews using Anthropic's Claude Sonnet API. The bot analyzes your pull requests using AI-powered code understanding tools and provides detailed, contextual feedback.

## Features

- Automatically triggers on PR open and updates
- Clones repositories and analyzes changes
- Uses ai-digest for codebase understanding
- Uses code2prompt for PR diff analysis
- Generates comprehensive PR reviews using Claude Sonnet
- Posts reviews directly as PR comments

## Prerequisites

- Node.js 18+
- [ai-digest](https://github.com/ai-digest) tool installed globally
- [code2prompt](https://github.com/code2prompt) tool installed globally
- GitHub App credentials
- Anthropic API key

## Setup

### Local Development with Smee.io

For local development, you'll need to use a webhook proxy to forward GitHub webhooks to your local machine:

1. Install smee-client globally:
   ```bash
   npm install -g smee-client
   ```

2. Create a new Smee channel at https://smee.io/new
   - Copy the URL - this will be your WEBHOOK_PROXY_URL

3. Start the Smee client:
   ```bash
   smee -u WEBHOOK_PROXY_URL -t http://localhost:3000/api/github/webhooks
   ```

4. Add the Smee URL to your GitHub App's webhook URL during development

### Production Setup

1. Create a GitHub App:
   - Go to your GitHub Settings > Developer Settings > GitHub Apps
   - Create a new app with the following permissions:
     - Pull requests: Read & Write
     - Contents: Read
   - Generate and download a private key
   - Note the App ID

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   ```bash
   cp .env.example .env
   ```
   Edit .env and add:
   - Your Anthropic API key
   - GitHub App credentials (APP_ID and PRIVATE_KEY)
   - Webhook secret

4. Start the bot:
   ```bash
   npm start
   ```

For local development:
   ```bash
   npm run dev
   ```

## Docker Deployment

1. Build the Docker image:
   ```bash
   docker build -t revu .
   ```

2. Create a .env file with your configuration:
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

3. Run the container:
   ```bash
   docker run -d \
     --name revu \
     -p 3000:3000 \
     --env-file .env \
     revu
   ```

4. View logs:
   ```bash
   docker logs -f revu
   ```

## How It Works

1. When a pull request is opened or updated, the bot:
   - Clones the repository
   - Uses ai-digest to generate a markdown representation of the codebase
   - Uses code2prompt to analyze the PR diff
   - Extracts the git log for context
   
2. This information is formatted into a prompt using the template in `templates/prompt.hbs`

3. The prompt is sent to Claude Sonnet API, which generates a comprehensive PR review

4. The review is automatically posted as a comment on the PR

## Environment Variables

- `ANTHROPIC_API_KEY`: Your Anthropic API key for Claude
- `APP_ID`: GitHub App ID
- `PRIVATE_KEY`: GitHub App private key (the actual key, not the path)
- `WEBHOOK_SECRET`: Secret for GitHub webhooks
- `WEBHOOK_PROXY_URL`: (Optional) URL for local development webhook proxy

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT
