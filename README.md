# revu

[📦 Installation](docs/INSTALLATION.md) | [⚙️ Configuration](docs/CONFIGURATION.md)

Revu is a GitHub App that provides intelligent, context-aware code reviews for pull requests using LLMs (Anthropic Claude and OpenAI GPT). It automatically analyzes pull requests when opened or marked ready for review, offering comprehensive feedback that goes beyond simple style checks, including extended thinking capabilities for deeper code analysis, security review, and architectural assessment.

## Quick Start

```bash
# Clone the repository
git clone https://github.com/SocialGouv/revu.git

# Install dependencies
yarn install

# Review a PR (dry-run mode - displays analysis without submitting)
yarn review-pr https://github.com/owner/repo/pull/123

# Review a PR and submit comments to GitHub
yarn review-pr https://github.com/owner/repo/pull/123 --submit
```

## License

MIT License