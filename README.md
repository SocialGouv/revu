# Revu - AI-Powered Code Review Assistant

Revu is a GitHub App that leverages LLMs to provide intelligent, context-aware code reviews for pull requests. By analyzing the entire codebase and changes, Revu offers comprehensive feedback that goes beyond simple style checks.

## Features

- **Extended Thinking** - Enhanced reasoning for deeper code analysis and security review
- **Contextual Analysis** - Understands changes in the context of the entire codebase
- **Precise Code Suggestions** - Suggests accurate code changes and improvements
- **PR Validation** - Automatically skips problematic PRs with helpful feedback
- **Customizable** - Configurable coding guidelines, branch filters, and file exclusions

## Quick Start

### Installation

```bash
# Use the correct Node.js version
nvm use v23.7.0

# Install dependencies
yarn install
```

### GitHub App Setup

1. Create a GitHub App at `Settings > Developer settings > GitHub Apps`
1. Configure permissions and events:

   ```yaml
   Webhook URL: Your server URL or smee.io proxy
   Permissions:
     - Pull requests: Read & write
     - Contents: Read
     - Organization members: Read # required for org membership checks
   Events:
     - Pull request
     - Pull request review
     - Pull request review comment # required for threaded discussion replies
   ```

1. Save your App ID, Private Key, and Webhook Secret

### Proxy User Setup

Since GitHub Apps cannot receive review requests directly, Revu uses a proxy user:

1. Create a dedicated GitHub user account (e.g., `revu-bot-reviewer`)
2. Generate a personal access token with repository access
3. Ensure the proxy user has read access to target repositories

### Environment Configuration

Create a `.env` file with the following variables:

```env
# Required
ANTHROPIC_API_KEY=your_anthropic_key
APP_ID=your_github_app_id
PRIVATE_KEY_PATH=path/to/private-key.pem
WEBHOOK_SECRET=your_webhook_secret
PROXY_REVIEWER_USERNAME=revu-bot-reviewer
PROXY_REVIEWER_TOKEN=proxy_user_token

# Optional
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
ANTHROPIC_EXTENDED_CONTEXT=true
WEBHOOK_PROXY_URL=https://smee.io/your-url
```

See [.env.example](.env.example) for an example.

## Running Revu

### Local Development

```bash
# Dry-run review of a PR using the current local version of Revu
yarn review-pr https://github.com/owner/repo/pull/123
# Submit comments to GitHub after analysis
yarn review-pr https://github.com/owner/repo/pull/123 --submit
```

### Production

```bash
# Local machine
yarn build
yarn start
```

## Usage

1. Install Revu on your GitHub repositories
2. When a PR is opened, Revu automatically adds the proxy user as a reviewer
3. Click "Request review" from the proxy user to trigger code review
4. Revu analyzes the code and posts detailed feedback

For CLI usage and testing, see [CLI Documentation](docs/cli-usage.md).

## Discussion replies

When a human user replies to a Revu inline review comment on a PR, Revu posts a concise threaded reply under the same review thread.

Behavior:

- Triggers only for replies (not new root comments) to Revu-marked comments.
- Requires the replying user to be an organization member (or at least a repo collaborator if org membership cannot be checked).
- Reuses the same review context (PR diff, modified files’ contents, coding guidelines, related issues) to ground the answer.
- Responses are concise; if a concrete fix is clear, a single GitHub suggestion fence is included.

Setup checklist:

- Enable the GitHub App event: “Pull request review comment”.
- Grant permission: “Organization members: Read”.
- Ensure PROXY_REVIEWER_USERNAME and PROXY_REVIEWER_TOKEN are configured.

Compute cache:

- Discussion replies are cached to avoid duplicate work on repeated deliveries.
- Cache key includes repo, PR, thread ids, reply content hash and commit SHA.
- Cache TTL defaults to 1 hour. Editing the user’s reply invalidates the cache automatically.

## Configuration

Revu is configurable through a `.revu.yml` file in your repository root:

```yaml
# Enable Extended Thinking
thinkingEnabled: true

# Custom coding guidelines
codingGuidelines:
  - 'Use descriptive variable names'
  - 'Add comments for complex logic'

# PR validation rules
validation:
  maxFilesChanged: 75
  maxDiffSize: 15000

# Branch filtering
branches:
  patterns:
    - '!**'
    - 'main'
    - 'release/*'
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see LICENSE file for details.
