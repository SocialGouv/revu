# Review Planning Strategy with Tree-of-Thoughts

## Overview

The Review Planning Strategy is an advanced code review approach that implements Tree-of-Thoughts (ToT) techniques to generate higher quality, more focused code reviews. It replaces the single-step review process with a sophisticated 2-step approach:

1. **Planning Phase**: Uses Tree-of-Thoughts to analyze the PR from multiple perspectives and create a review plan
2. **Execution Phase**: Uses the review plan to generate targeted, high-quality comments

## Architecture

### Core Components

```txt
src/prompt-strategies/
├── planning-strategy.ts     # Main orchestrator
├── planning/
│   └── planning-phase.ts    # Step 1: Review planning
└── execution/
  └── guided-execution-phase.ts      # Step 2: Guided execution

src/anthropic-senders/
├── planning-sender.ts       # Planning phase API sender
└── guided-execution-sender.ts         # Execution phase API sender

templates/
├── planning-prompt.hbs      # Tree-of-Thoughts planning template
└── guided-execution-prompt.hbs        # Plan-guided execution template
```

### Data Flow

```txt
PR Data → Review Planning Phase → Review Plan → Guided Execution Phase → Comments
```

## Tree-of-Thoughts Implementation

### Step 1: Review Planning Phase

The planning phase implements Tree-of-Thoughts by:

1. **Multiple Perspective Generation**: Analyzes the PR from 5-7 different angles:
   - Security (vulnerabilities, input validation, authentication)
   - Performance (efficiency, scalability, bottlenecks)
   - Maintainability (code clarity, modularity, technical debt)
   - Testing (coverage, quality, edge cases)
   - Architecture (design patterns, coupling, cohesion)
   - Error Handling (exception management, logging)
   - Data Integrity (validation, consistency, corruption prevention)

2. **Relevance Assessment**: Each perspective is scored 1-10 for relevance to the specific PR

3. **Priority Focus Area Identification**: Selects 3-5 high-impact areas that deserve concentrated attention

4. **Review Approach Synthesis**: Creates a coherent review strategy that balances thoroughness with efficiency

### Step 2: Guided Execution Phase

The execution phase uses the review plan to:

1. **Prioritize Comments**: Focus on issues identified in the planning phase
2. **Filter Noise**: Skip low-impact issues not aligned with review priorities
3. **Provide Context**: Reference the review plan in comments when relevant
4. **Maintain Quality**: Generate the same structured output as the original system

## Configuration

### Enabling Review Planning Strategy

Update `config.json`:

```json
{
  "promptStrategy": "review-planning"
}
```

## Future Enhancements

### Potential Improvements

1. **Adaptive Planning**: Adjust planning depth based on PR complexity
2. **Learning Integration**: Use historical review data to improve planning
3. **Custom Perspectives**: Allow configuration of review perspectives
4. **Multi-Language Support**: Specialized planning for different programming languages
5. **Integration Testing**: Automated testing of the 2-phase process
