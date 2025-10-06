# Extended Thinking Support

Revu now supports Anthropic's Extended Thinking feature for enhanced code review capabilities. This feature enables Claude to perform deeper reasoning and analysis during the review process.

## Overview

Extended thinking allows Claude to internally reason through complex code patterns, architectural decisions, and potential issues before providing feedback. This results in more thorough and insightful code reviews.

## Configuration

### Structure

Extended thinking is controlled through separate configuration options in `config.json`:

```json
{
    "promptStrategy": "line-comments",
    "thinkingEnabled": true
}
```

### Configuration Options

- `promptStrategy`: The review strategy to use (`"line-comments"` is currently the only available strategy)
- `thinkingEnabled`: Boolean flag to enable/disable Extended Thinking capabilities

## Technical Details

### Token Budget

- **Thinking Budget**: 16,000 tokens allocated for internal reasoning
- **Total Max Tokens**: 20,096 tokens (16k thinking + ~4k structured output)
- **Model**: Claude Sonnet 4.5 (`claude-sonnet-4-5-20250929`)

### Response Processing

When thinking is enabled:

1. Claude generates internal reasoning (thinking blocks)
2. Claude provides structured code review using tool calling
3. Only the structured review output is returned to users
4. Thinking blocks are automatically filtered out for privacy

### Cost Considerations

- Extended thinking incurs additional costs (~$0.15 per review with 16k thinking budget)
- Thinking tokens are billed as output tokens at $15/MTok for Claude Sonnet 4
- The enhanced review quality typically justifies the modest cost increase

## Benefits

Extended thinking provides significant improvements in:

- **Complex Logic Analysis**: Better understanding of intricate code patterns
- **Security Vulnerability Detection**: More thorough reasoning about potential security issues
- **Architecture Assessment**: Deeper analysis of design decisions and patterns
- **Edge Case Identification**: More comprehensive consideration of failure modes
- **Code Quality Suggestions**: More thoughtful and contextual recommendations

## Implementation

The feature is implemented as an enhancement to the existing `lineCommentsSender`:

- Conditionally enables thinking based on strategy name
- Maintains backward compatibility with existing configurations
- Uses the same response processing pipeline
- Preserves all existing functionality and integrations
