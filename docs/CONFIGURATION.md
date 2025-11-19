# Configuration Guide

[🏠 Home](../README.md) | [📦 Installation](INSTALLATION.md)

## Overview

Revu uses environment variables and a JSON configuration file to manage settings. The application supports multiple LLM providers (Anthropic Claude and OpenAI GPT) and requires GitHub App authentication for webhook integration and API access.

Configuration is handled in two ways:
1. **Environment Variables** (`.env` file) - For sensitive credentials and deployment-specific settings
2. **Configuration File** (`config.json`) - For application behavior settings like prompt strategy and LLM provider selection

## Environment Variables

### Required Variables

The following environment variables are required for Revu to function:

| Variable | Description | Example Value |
| -------- | ----------- | ------------- |
| `ANTHROPIC_API_KEY` | Your Anthropic API key for Claude (required when `llmProvider` is `anthropic` or not set) | `sk-ant-...` |
| `APP_ID` | GitHub App ID for authentication | `123456` |
| `PRIVATE_KEY` or `PRIVATE_KEY_PATH` | GitHub App private key. Use `PRIVATE_KEY_PATH` to point to a `.pem` file, or `PRIVATE_KEY` to provide the key directly (with `\n` for line breaks) or as base64-encoded | `./github-app.pem` or `-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----` |
| `WEBHOOK_SECRET` | GitHub webhook secret for validating incoming webhook payloads | `your_webhook_secret` |

### Optional Variables

| Variable | Description | Default Value | Example Value |
| -------- | ----------- | ------------- | ------------- |
| `ANTHROPIC_MODEL` | Anthropic model to use for code reviews | `claude-sonnet-4-5-20250929` | `claude-sonnet-4-5-20250929` |
| `ANTHROPIC_EXTENDED_CONTEXT` | Enable 1M token context window (opt-out: enabled by default) | `true` | `false` (to disable) |
| `LLM_PROVIDER` | LLM provider selection (overrides `config.json` if not explicitly set there) | `anthropic` | `openai` |
| `OPENAI_MODEL` | OpenAI model to use for code reviews | `gpt-5` | `gpt-4o` |
| `OPENAI_API_KEY` | OpenAI API key (required when `llmProvider` is set to `openai`) | `sk-...` |
| `WEBHOOK_PROXY_URL` | Webhook proxy URL for local development (e.g., smee.io) | None | `https://smee.io/your-channel` |
| `PROXY_REVIEWER_USERNAME` | Username for manual review requests via comments | None | `bot-user` |
| `PROXY_REVIEWER_TOKEN` | GitHub token for proxy reviewer user | None | `ghp_...` |
| `HOST` | Server host address | `0.0.0.0` | `127.0.0.1` |
| `PORT` | Server port | `3000` | `8080` |
| `GIT_PATH` | Full path to git executable (security: prevents PATH manipulation attacks) | `/usr/bin/git` | `/usr/local/bin/git` |

## Configuration Files

### Main Configuration File

**Location**: `config.json` (project root)

**Format**: JSON

The `config.json` file controls application behavior and can be used to set the LLM provider, enable thinking mode, and select prompt strategies.

```json
{
  "promptStrategy": "line-comments",
  "thinkingEnabled": true,
  "llmProvider": "anthropic"
}
```

**Available Options:**

- **`promptStrategy`** (string, required): The prompt strategy to use for code review
  - Default: `"line-comments"`
  - Currently supported: `"line-comments"`

- **`thinkingEnabled`** (boolean, optional): Enable Anthropic's extended thinking capabilities or OpenAI's adjusted temperature/instructions for deeper analysis
  - Default: `false`
  - When `true`: Enables chain-of-thought reasoning for more thorough code analysis

- **`llmProvider`** (string, optional): LLM provider to use for analysis
  - Default: `"anthropic"`
  - Allowed values: `"anthropic"` | `"openai"`
  - Note: This can be overridden by the `LLM_PROVIDER` environment variable if not explicitly set in `config.json`

### Configuration Precedence

For `llmProvider` specifically:
1. If `llmProvider` is explicitly set in `config.json`, it takes precedence
2. Otherwise, if `LLM_PROVIDER` environment variable is set, it will be used
3. If neither is set, defaults to `"anthropic"`

### Additional Configuration Files

#### `.env.example`

**Location**: `.env.example` (project root)

**Purpose**: Template file showing all available environment variables with example values. Copy this to `.env` and fill in your actual values.

```bash
cp .env.example .env
```

## Configuration Examples

### Minimal Configuration

The absolute minimum configuration needed to run with Anthropic (default):

**`.env` file:**
```bash
# Anthropic Configuration (default provider)
ANTHROPIC_API_KEY=sk-ant-your-api-key-here

# GitHub App Configuration
APP_ID=123456
PRIVATE_KEY_PATH=./github-app.pem
WEBHOOK_SECRET=your_webhook_secret
```

**`config.json` file:**
```json
{
  "promptStrategy": "line-comments"
}
```

### Development Configuration

Typical development setup with all common options:

**`.env` file:**
```bash
# Anthropic API Key
ANTHROPIC_API_KEY=sk-ant-your-api-key-here

# Anthropic Model Configuration
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929

# Enable 1M token context window (opt-out: enabled by default)
ANTHROPIC_EXTENDED_CONTEXT=true

# GitHub App Configuration
APP_ID=123456
PRIVATE_KEY_PATH=./github-app.pem
WEBHOOK_SECRET=your_webhook_secret

# Optional: Webhook Proxy URL for local development
WEBHOOK_PROXY_URL=https://smee.io/your-channel

# Proxy User Configuration (for manual review requests)
PROXY_REVIEWER_USERNAME=bot-user
PROXY_REVIEWER_TOKEN=ghp_your_token_here

# Server Configuration
HOST=0.0.0.0
PORT=3000
```

**`config.json` file:**
```json
{
  "promptStrategy": "line-comments",
  "thinkingEnabled": true,
  "llmProvider": "anthropic"
}
```

### OpenAI Configuration

Configuration for using OpenAI instead of Anthropic:

**`.env` file:**
```bash
# OpenAI Configuration
OPENAI_API_KEY=sk-your-openai-key-here
OPENAI_MODEL=gpt-5

# LLM Provider Selection (can also be set in config.json)
LLM_PROVIDER=openai

# GitHub App Configuration
APP_ID=123456
PRIVATE_KEY_PATH=./github-app.pem
WEBHOOK_SECRET=your_webhook_secret

# Server Configuration
HOST=0.0.0.0
PORT=3000
```

**`config.json` file:**
```json
{
  "promptStrategy": "line-comments",
  "thinkingEnabled": false,
  "llmProvider": "openai"
}
```

## Next Steps

After configuring the application:

- [📦 Installation](INSTALLATION.md) - Review installation steps
