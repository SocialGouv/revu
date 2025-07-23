import Anthropic from '@anthropic-ai/sdk'
import type { ReviewPlan } from '../prompt-strategies/planning/plan-review.ts'
import { processAnthropicResponse } from './response-processor.ts'

/**
 * Planning Anthropic sender.
 * This sender uses Anthropic's Tool Use / Function Calling capability
 * to enforce a structured JSON response for the planning phase.
 * It generates an array of issues.
 *
 * @param prompt - The planning prompt to send to Anthropic
 * @returns A stringified JSON response containing the review plan
 */
export async function reviewPlanningSender(prompt: string): Promise<string> {
  // Initialize Anthropic client
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
  })

  // Send to Anthropic API with tool use configuration for planning
  const message = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    temperature: 0, // Slightly higher temperature for creative planning
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ],
    tools: [
      {
        name: 'provide_review_plan',
        description: 'Provide a review plan with detected issues',
        input_schema: {
          type: 'object',
          properties: {
            issues: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: {
                    type: 'string',
                    description: 'Unique identifier for the issue'
                  },
                  file_path: {
                    type: 'string',
                    description: 'Path to the file containing the issue'
                  },
                  line: {
                    type: 'integer',
                    description: 'Line number where the issue occurs (optional)'
                  },
                  issue_type: {
                    type: 'string',
                    enum: [
                      'security',
                      'performance',
                      'bug',
                      'maintainability',
                      'style',
                      'testing'
                    ],
                    description: 'Category of the detected issue'
                  },
                  severity: {
                    type: 'string',
                    enum: ['critical', 'high', 'medium', 'low'],
                    description: 'Severity level of the issue'
                  },
                  title: {
                    type: 'string',
                    description: 'Brief, descriptive title of the issue'
                  },
                  description: {
                    type: 'string',
                    description:
                      'Detailed explanation of the issue and its impact'
                  },
                  context: {
                    type: 'string',
                    description: 'Relevant code snippet and surrounding context'
                  },
                  suggested_fix: {
                    type: 'string',
                    description: 'Single, clear fix description'
                  },
                  code_suggestion: {
                    type: 'string',
                    description: 'Optional improved code example'
                  }
                },
                required: [
                  'id',
                  'file_path',
                  'issue_type',
                  'severity',
                  'title',
                  'description',
                  'context',
                  'suggested_fix'
                ]
              },
              description: 'Array of detected issues in the PR'
            }
          },
          required: ['issues']
        }
      }
    ]
  })

  // Use shared response processor with review planning specific validation
  return processAnthropicResponse<ReviewPlan>(message, {
    expectedToolName: 'provide_review_plan',
    contextName: 'Review planning',
    customValidator: (parsed: unknown) => {
      return (
        parsed &&
        typeof parsed === 'object' &&
        parsed !== null &&
        'issues' in parsed &&
        Array.isArray((parsed as { issues: unknown }).issues)
      )
    }
  })
}
