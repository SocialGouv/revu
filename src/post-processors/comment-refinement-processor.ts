import Anthropic from '@anthropic-ai/sdk'
import * as fs from 'fs/promises'
import Handlebars from 'handlebars'
import * as path from 'path'
import { logSystemError, logSystemWarning } from '../utils/logger.ts'
import type { PostProcessingConfig, PostProcessor } from './post-processor.ts'

// Types for the refinement response
interface CommentRefinementDecision {
  action: 'keep' | 'improve' | 'remove'
  comment?: {
    path: string
    line: number
    start_line?: number
    body: string
    search_replace_blocks?: Array<{
      search: string
      replace: string
    }>
  }
  reason: string
}

interface CommentRefinementResponse {
  decisions: CommentRefinementDecision[]
}

/**
 * Comment refinement post-processor that uses a second LLM call
 * to review and refine AI-generated comments
 */
export class CommentRefinementProcessor implements PostProcessor {
  private config: PostProcessingConfig
  private anthropic: Anthropic

  constructor(config: PostProcessingConfig) {
    this.config = config
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    })
  }

  /**
   * Process and refine comments using a second LLM call
   */
  async process(
    comments: Array<{
      path: string
      line: number
      start_line?: number
      body: string
      search_replace_blocks?: Array<{
        search: string
        replace: string
      }>
    }>,
    context?: {
      prTitle?: string
      prBody?: string
      diff?: string
      codingGuidelines?: string
    }
  ): Promise<
    Array<{
      path: string
      line: number
      start_line?: number
      body: string
      search_replace_blocks?: Array<{
        search: string
        replace: string
      }>
    }>
  > {
    // If no comments to process, return empty array
    if (!comments || comments.length === 0) {
      return []
    }

    try {
      // Generate the refinement prompt
      const prompt = await this.generateRefinementPrompt(comments, context)

      // Send to Anthropic for refinement
      const refinementResponse = await this.sendRefinementRequest(prompt)

      // Process the refinement decisions
      return this.processRefinementDecisions(refinementResponse, comments)
    } catch (error) {
      logSystemError(error, {
        context_msg:
          'Error in comment refinement post-processing, returning original comments'
      })
      // On error, return original comments to maintain functionality
      return comments
    }
  }

  /**
   * Generate the refinement prompt using the Handlebars template
   */
  private async generateRefinementPrompt(
    comments: Array<{
      path: string
      line: number
      start_line?: number
      body: string
      search_replace_blocks?: Array<{
        search: string
        replace: string
      }>
    }>,
    context?: {
      prTitle?: string
      prBody?: string
      diff?: string
      codingGuidelines?: string
    }
  ): Promise<string> {
    const templatePath = path.join(
      process.cwd(),
      'src',
      'post-processors',
      'templates',
      'comment-refinement-prompt.hbs'
    )

    const templateContent = await fs.readFile(templatePath, 'utf-8')
    const template = Handlebars.compile(templateContent)

    return template({
      comments,
      prTitle: context?.prTitle,
      prBody: context?.prBody,
      diff: context?.diff,
      codingGuidelines: context?.codingGuidelines
    })
  }

  /**
   * Send the refinement request to Anthropic
   */
  private async sendRefinementRequest(
    prompt: string
  ): Promise<CommentRefinementResponse> {
    const message = await this.anthropic.messages.create({
      model: this.config.model || 'claude-haiku-3-20240307',
      max_tokens: this.config.maxTokens || 2048,
      temperature: this.config.temperature || 0,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      tools: [
        {
          name: 'refine_comments',
          description: 'Provide refinement decisions for code review comments',
          input_schema: {
            type: 'object',
            properties: {
              decisions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    action: {
                      type: 'string',
                      enum: ['keep', 'improve', 'remove'],
                      description: 'Action to take with this comment'
                    },
                    comment: {
                      type: 'object',
                      properties: {
                        path: {
                          type: 'string',
                          description: 'File path relative to repository root'
                        },
                        line: {
                          type: 'integer',
                          description: 'End line number for the comment'
                        },
                        start_line: {
                          type: 'integer',
                          description:
                            'Start line number for multi-line comments (optional)'
                        },
                        body: {
                          type: 'string',
                          description: 'Comment text'
                        },
                        search_replace_blocks: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              search: {
                                type: 'string',
                                description: 'Exact code content to find'
                              },
                              replace: {
                                type: 'string',
                                description: 'New code content to replace with'
                              }
                            },
                            required: ['search', 'replace']
                          },
                          description:
                            'SEARCH/REPLACE blocks for code modifications'
                        }
                      },
                      required: ['path', 'line', 'body']
                    },
                    reason: {
                      type: 'string',
                      description: 'Brief explanation of the decision'
                    }
                  },
                  required: ['action', 'reason']
                }
              }
            },
            required: ['decisions']
          }
        }
      ]
    })

    // Extract response from tool use
    for (const content of message.content) {
      if (content.type === 'tool_use') {
        if (content.name === 'refine_comments' && content.input) {
          return content.input as CommentRefinementResponse
        } else {
          throw new Error(`Unexpected tool name: ${content.name}`)
        }
      } else if (content.type === 'text') {
        // Try to parse JSON from text as fallback
        try {
          const text = content.text.trim()
          if (text.startsWith('{') && text.endsWith('}')) {
            return JSON.parse(text) as CommentRefinementResponse
          }
        } catch (error) {
          throw new Error(
            `Failed to parse JSON from text response: ${error.message}`
          )
        }
      }
    }

    throw new Error('Unexpected response format from Anthropic refinement call')
  }

  /**
   * Process the refinement decisions and return the refined comments
   */
  private processRefinementDecisions(
    response: CommentRefinementResponse,
    originalComments: Array<{
      path: string
      line: number
      start_line?: number
      body: string
      search_replace_blocks?: Array<{
        search: string
        replace: string
      }>
    }>
  ): Array<{
    path: string
    line: number
    start_line?: number
    body: string
    search_replace_blocks?: Array<{
      search: string
      replace: string
    }>
  }> {
    const refinedComments: Array<{
      path: string
      line: number
      start_line?: number
      body: string
      search_replace_blocks?: Array<{
        search: string
        replace: string
      }>
    }> = []

    let keptCount = 0
    let improvedCount = 0
    let removedCount = 0

    // Process each decision
    for (let i = 0; i < response.decisions.length; i++) {
      const decision = response.decisions[i]
      const originalComment = originalComments[i]

      if (!originalComment) {
        logSystemWarning(
          new Error(
            `Refinement decision ${i} has no corresponding original comment`
          ),
          { context_msg: 'Skipping refinement decision' }
        )
        continue
      }

      switch (decision.action) {
        case 'keep':
          refinedComments.push(originalComment)
          keptCount++
          console.log(
            `Kept comment for ${originalComment.path}:${originalComment.line} - ${decision.reason}`
          )
          break

        case 'improve':
          if (decision.comment) {
            refinedComments.push(decision.comment)
            improvedCount++
            console.log(
              `Improved comment for ${originalComment.path}:${originalComment.line} - ${decision.reason}`
            )
          } else {
            logSystemWarning(
              new Error(
                `Improve decision for comment ${i} missing improved comment`
              ),
              { context_msg: 'Keeping original comment' }
            )
            refinedComments.push(originalComment)
            keptCount++
          }
          break

        case 'remove':
          removedCount++
          console.log(
            `Removed comment for ${originalComment.path}:${originalComment.line} - ${decision.reason}`
          )
          // Don't add to refinedComments array
          break

        default:
          logSystemWarning(
            new Error(`Unknown refinement action: ${decision.action}`),
            { context_msg: 'Keeping original comment' }
          )
          refinedComments.push(originalComment)
          keptCount++
          break
      }
    }

    console.log(
      `Comment refinement complete: ${keptCount} kept, ${improvedCount} improved, ${removedCount} removed (${originalComments.length} → ${refinedComments.length})`
    )

    return refinedComments
  }
}
