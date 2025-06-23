# Revu: AI-Powered Code Review Assistant

## Project Identity

- GitHub App using Anthropic's Claude AI for intelligent PR reviews
- Analyzes entire codebase, changes, and commit history for context-aware feedback
- Integrates with GitHub's PR workflow

## Architecture

- **Event Triggers**: PR opened/updated → extract data → analyze → post comments
- **Data Pipeline**:
  - Extract codebase (filtered by .revuignore)
  - Extract PR diff
  - Extract git history
  - Populate template with data
  - Send to Claude
  - Post comments to GitHub

## Strategy System

- **Prompt Strategies**: Different templates for Claude (default, line-comments)
- **Anthropic Senders**: Format requests to Claude API based on strategy
- **Comment Handlers**: Post reviews as global comments or line-specific comments
- Current config: "line-comments" strategy (provides feedback as inline comments on specific code lines rather than a single PR comment)

## Key Files

### Core Application

- `src/index.ts`: Main app entry point, PR event handling
- `config.json`: Strategy configuration

### Data Processing

- `src/extract-*.ts`: Data extraction modules
- `src/send-to-anthropic.ts`: Claude API integration

### Review Strategy

- `src/prompt-strategies/`: Different prompt formatting approaches
- `src/comment-handlers/`: GitHub comment posting logic
- `templates/*.hbs`: Handlebars templates for Claude prompts

### Configuration

- `.revu.yml`: Custom coding guidelines
- `.revuignore`: File filtering (like .gitignore)
- `config.json`: Strategy configuration

## Development Context

- Node.js application using Probot framework
- Requires GitHub App credentials and Anthropic API key
- Supports both global comments and line-specific comments
- Includes smart comment management to prevent comment accumulation
- Configurable through environment variables and YAML files
