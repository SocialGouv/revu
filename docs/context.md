# Revu: AI-Powered Code Review Assistant

## Project Identity

- GitHub App using Anthropic's Claude AI for intelligent PR reviews
- Analyzes entire codebase, changes, and commit history for context-aware feedback
- Integrates with GitHub's PR workflow

## Architecture

- **Event Triggers**:
  - PR opened → add proxy user as reviewer
  - PR review requested (for proxy user) → check if draft → extract data → analyze → post comments (skips draft PRs)
  - PR ready for review → automatically extract data → analyze → post comments
- **Proxy User System**: Uses a regular GitHub user account to enable manual review requests
- **Draft PR Handling**: Skips review requests on draft PRs, automatically reviews when PR becomes ready
- **Data Pipeline**:
  - Extract codebase (filtered by .revuignore)
  - Extract PR diff
  - Extract git history
  - Populate template with data
  - Send to Claude
  - Process SEARCH/REPLACE blocks for precise code suggestions
  - Post comments to GitHub via proxy user

## Strategy System

- **Prompt Strategies**: Different templates for Claude (currently only line-comments strategy available)
- **Anthropic Senders**: Format requests to Claude API based on strategy and thinking configuration
- **Comment Handlers**: Post reviews as global comments or line-specific comments
- **SEARCH/REPLACE Processing**: Pattern matching system for precise code suggestions with exact character-for-character matching
- **Extended Thinking Support**: Enhanced reasoning capabilities using Anthropic's Extended Thinking feature
- **Configuration Structure**: Separate `promptStrategy` and `thinkingEnabled` settings for better modularity
- Current config: "line-comments" strategy with thinking enabled (provides feedback as inline comments with extended thinking for deeper analysis)

## Key Files

### Core Application

- `src/index.ts`: Main app entry point, PR event handling, review request detection
- `src/github/reviewer-utils.ts`: Proxy user management and reviewer assignment
- `config.json`: Strategy configuration

### Data Processing

- `src/extract-*.ts`: Data extraction modules
- `src/send-to-anthropic.ts`: Claude API integration
- `src/core/services/search-replace-processor.ts`: SEARCH/REPLACE block processing and pattern matching

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
- Uses functional programming everywhere
- Requires GitHub App credentials and Anthropic API key
- **Proxy User System**: Requires additional GitHub user account and personal access token for manual review requests
- **SEARCH/REPLACE Block System**: Provides precise code suggestions with pattern matching for better accuracy
- **Extended Thinking**: Leverages Anthropic's Extended Thinking for enhanced reasoning and deeper code analysis
- Includes smart comment management to prevent comment accumulation
- Configurable through environment variables and YAML files
- Environment variables: `PROXY_REVIEWER_USERNAME`, `PROXY_REVIEWER_TOKEN` for proxy user functionality
