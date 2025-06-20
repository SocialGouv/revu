import Anthropic from '@anthropic-ai/sdk'

/**
 * Default Anthropic sender.
 * This sender is used by default and sends the prompt to Anthropic
 * expecting a regular text response.
 *
 * @param prompt - The prompt to send to Anthropic
 * @returns The text response from Anthropic
 */
export async function defaultSender(prompt: string): Promise<string> {
  // Initialize Anthropic client
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
  })

  // Send to Anthropic API
  const message = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    temperature: 0, // Using 0 for consistent, deterministic code review feedback
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  })

  // Extract text from the content block
  if (message.content[0].type !== 'text') {
    throw new Error('Unexpected response type from Anthropic')
  }
  return message.content[0].text
}
