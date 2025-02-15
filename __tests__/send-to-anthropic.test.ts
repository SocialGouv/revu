import { describe, it, expect } from 'vitest';
import { sendToAnthropic } from '../src/send-to-anthropic.ts';

describe('sendToAnthropic', () => {
  it('should send prompt to Anthropic API and return response', async () => {
    const result = await sendToAnthropic({
      repositoryUrl: 'https://github.com/SocialGouv/carnets.git',
      branch: 'ai-digest'
    });

    console.log('\nAnthropicAPI Response:');
    console.log('----------------------------------------');
    console.log(result);
    console.log('----------------------------------------\n');

    expect(result).toBeTruthy();
  }, 60000);
});
