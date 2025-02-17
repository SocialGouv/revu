import Anthropic from '@anthropic-ai/sdk';
import { populateTemplate } from './populate-template.ts';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface SendToAnthropicOptions {
  repositoryUrl: string;
  branch: string;
}

export async function sendToAnthropic({
  repositoryUrl,
  branch
}: SendToAnthropicOptions) {
  // Initialize Anthropic client
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
  });

  // Get the populated template
  const prompt = await populateTemplate({
    repositoryUrl,
    branch
  });

  // Send to Anthropic API
  const message = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-latest',
    max_tokens: 4096,
    temperature: 0.7,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  });

  // Extract text from the content block
  if (message.content[0].type !== 'text') {
    throw new Error('Unexpected response type from Anthropic');
  }
  return message.content[0].text;
}
