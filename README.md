# Revu - AI-Powered Code Review Assistant

Revu is a GitHub App that leverages Anthropic's Claude AI to provide intelligent, context-aware code reviews for pull requests. By analyzing the entire codebase, changes, and commit history, Revu offers comprehensive feedback that goes beyond simple style checks.

## Features

- **Contextual Analysis**: Understands code changes in the context of the entire codebase
- **Intelligent Feedback**: Provides detailed explanations and suggestions for improvements
- **Git-Aware**: Considers commit history and branch differences
- **GitHub Integration**: Seamlessly integrates with GitHub's PR workflow
- **Customizable**: Configurable through environment variables and templates

## How It Works

```mermaid
graph TD
    A[PR Created/Updated] --> B[Extract Data]
    B --> C[Codebase Analysis]
    B --> D[PR Diff]
    B --> E[Git History]
    C --> F[Generate Prompt]
    D --> F
    E --> F
    F --> G[Claude Analysis]
    G --> H[Post PR Comment]
```

1. **Trigger**: When a PR is opened or updated
2. **Data Collection**:
   - Extracts full codebase for context
   - Generates diff to focus on changes
   - Retrieves git history for background
3. **Analysis**:
   - Combines data into a structured prompt
   - Sends to Claude for intelligent analysis
4. **Feedback**: Posts detailed review comments on the PR

## Setup and Installation

### Prerequisites and Installation

```bash
# Ensure correct Node.js version
nvm use v23.7.0

# Install dependencies
yarn install

# Install development tools
npm install -g smee-client  # For local webhook testing
```

Requirements:

- Node.js v23.7.0 (managed via nvm)
- GitHub account with admin access
- Anthropic API key

### GitHub App Configuration

1. Create a new GitHub App at `Settings > Developer settings > GitHub Apps`
2. Configure the app:

   ```yaml
   Name: Revu (or your preferred name)
   Webhook URL: Your server URL or smee.io proxy
   Permissions:
     - Pull requests: Read & write
     - Contents: Read
   Events: Pull request
   ```

3. Generate and save:
   - Private key
   - App ID
   - Webhook secret

### Environment Configuration

| Variable            | Type   | Description                                                                |
| ------------------- | ------ | -------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` | string | Your Anthropic API key for accessing Claude API                            |
| `APP_ID`            | number | GitHub App ID obtained after registering the app                           |
| `PRIVATE_KEY`       | string | RSA private key generated for the GitHub App (including BEGIN/END markers) |
| `WEBHOOK_SECRET`    | string | Secret string used to verify GitHub webhook payloads                       |
| `WEBHOOK_PROXY_URL` | string | (Optional) Smee.io URL for local development webhook forwarding            |
| `REPOSITORY_FOLDER` | string | Absolute path where repositories will be cloned                            |

## Running the App

### Local Development

```bash
# Start webhook proxy (in a separate terminal)
smee -u https://smee.io/your-smee-url -t http://localhost:3000/api/github/webhooks

# Start the app
yarn dev
```

### Production Deployment

Choose one of the following methods:

#### Local Machine

```bash
yarn build
yarn start
```

#### Docker

```bash
docker build -t revu .
docker run -d \
  -p 3000:3000 \
  --env-file .env \
  -v /path/to/local/repos:/app/repos \
  revu
```

## API Reference

The API is organized in layers, with each function calling the next layer down:

```mermaid
graph TD
    A[sendToAnthropic] --> B[populateTemplate]
    B --> C[extractAll]
    C --> D[extractCodebaseFromRepo]
    C --> E[extractDiffFromRepo]
    C --> F[extractLogFromRepo]
```

### Core Functions

```typescript
// Main entry point - initiates the review process
sendToAnthropic({
  repositoryUrl: string,  // GitHub repository URL
  branch: string         // Branch to analyze
}): Promise<string>      // Returns Claude's analysis

// Combines repository data with template
populateTemplate({
  repositoryUrl: string,
  branch: string,
  templatePath?: string  // Default: templates/prompt.hbs
}): Promise<string>

// Coordinates data extraction
extractAll({
  repositoryUrl: string,
  branch: string,
  tempFolder?: string
}): Promise<{
  codebase: string,     // Processed repository content
  diff: string,         // Git diff output
  log: string          // Commit history
}>
```

### Utility Functions

```typescript
// Extract and process repository content
extractCodebaseFromRepo({
  branch: string,
  repoPath: string
}): Promise<string>

// Generate git diff against default branch
extractDiffFromRepo({
  branch: string,
  repoPath: string
}): Promise<string>

// Get formatted commit history
extractLogFromRepo({
  branch: string,
  repoPath: string
}): Promise<string>
```

### Configuration

- Model: Claude 3 Sonnet
- Max tokens: 4096
- Temperature: 0.7
- Required env: `ANTHROPIC_API_KEY`

## Troubleshooting

### Common Issues

1. **Webhook Not Receiving Events**
   - Verify smee.io proxy is running
   - Check webhook URL in GitHub App settings
   - Ensure correct port forwarding

2. **Authentication Errors**
   - Validate ANTHROPIC_API_KEY
   - Check GitHub App credentials
   - Verify private key format

3. **Repository Access Issues**
   - Confirm GitHub App installation
   - Check repository permissions
   - Verify REPOSITORY_FOLDER path exists

### Debug Mode

Enable debug logging:

```bash
DEBUG=revu:* yarn dev
```

## Contributing

1. **Development Setup**

   ```bash
   git clone https://github.com/your-username/revu.git
   cd revu
   yarn install
   ```

2. **Testing**

   ```bash
   yarn test        # Run all tests
   yarn test:watch  # Watch mode
   ```

3. **Code Style**
   - Use TypeScript
   - Follow existing patterns
   - Add JSDoc comments
   - Include tests

4. **Pull Requests**
   - Create feature branch
   - Add tests
   - Update documentation
   - Submit PR with description

## License

This project is licensed under the MIT License.

```text
MIT License

Copyright (c) 2025 Revu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
