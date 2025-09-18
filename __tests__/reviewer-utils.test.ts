import { describe, expect, it } from 'vitest'
import { isAutomatedSender } from '../src/github/reviewer-utils.ts'

type Sender = { login: string; type: string }

// Test helper functions
const createSender = (login: string, type: string): Sender => ({ login, type })

const expectAutomatedSender = (
  sender: Sender,
  proxyUsername: string,
  expected: boolean
) => {
  const result = isAutomatedSender(sender, proxyUsername)
  expect(result).toBe(expected)
}

const automatedSenderTests = {
  shouldReturnTrue: (
    description: string,
    sender: Sender,
    proxyUsername: string = 'proxy-user'
  ) => {
    it(description, () => {
      expectAutomatedSender(sender, proxyUsername, true)
    })
  },
  shouldReturnFalse: (
    description: string,
    sender: Sender,
    proxyUsername: string = 'proxy-user'
  ) => {
    it(description, () => {
      expectAutomatedSender(sender, proxyUsername, false)
    })
  }
}

describe('isAutomatedSender', () => {
  describe('bot sender detection', () => {
    automatedSenderTests.shouldReturnTrue(
      'should return true for bot sender with lowercase type',
      createSender('github-actions[bot]', 'bot')
    )

    automatedSenderTests.shouldReturnTrue(
      'should return true for bot sender with uppercase type',
      createSender('dependabot[bot]', 'BOT')
    )
  })

  describe('proxy user detection', () => {
    automatedSenderTests.shouldReturnTrue(
      'should return true when sender login matches proxy username',
      createSender('proxy-user', 'User')
    )

    automatedSenderTests.shouldReturnTrue(
      'should return true when sender login matches proxy username with different type',
      createSender('my-proxy', 'Organization'),
      'my-proxy'
    )

    automatedSenderTests.shouldReturnFalse(
      'should return false when sender login does not match proxy username',
      createSender('different-user', 'User')
    )

    automatedSenderTests.shouldReturnFalse(
      'should be case sensitive for proxy username matching',
      createSender('Proxy-User', 'User')
    )
  })

  describe('human user detection', () => {
    const humanUserCases = [
      { login: 'human-user', type: 'User', description: 'human user' },
      {
        login: 'org-user',
        type: 'Organization',
        description: 'organization user'
      },
      {
        login: 'unknown-user',
        type: 'Unknown',
        description: 'user with unknown type'
      }
    ]

    humanUserCases.forEach(({ login, type, description }) => {
      automatedSenderTests.shouldReturnFalse(
        `should return false for ${description} that is not proxy`,
        createSender(login, type)
      )
    })
  })

  describe('edge cases', () => {
    const edgeCases = [
      {
        description:
          'should return false when sender type is empty string and not proxy',
        sender: createSender('user', ''),
        proxyUsername: 'proxy-user',
        expected: false
      },
      {
        description:
          'should return true when sender type is empty string but matches proxy',
        sender: createSender('proxy-user', ''),
        proxyUsername: 'proxy-user',
        expected: true
      },
      {
        description: 'should return false when proxy username is empty string',
        sender: createSender('user', 'User'),
        proxyUsername: '',
        expected: false
      },
      {
        description:
          'should return false when both sender login and proxy username are empty strings',
        sender: createSender('', 'User'),
        proxyUsername: '',
        expected: false
      },
      {
        description: 'should handle type with extra whitespace',
        sender: createSender('user', ' bot '),
        proxyUsername: 'proxy-user',
        expected: true
      }
    ]

    edgeCases.forEach(({ description, sender, proxyUsername, expected }) => {
      it(description, () => {
        expectAutomatedSender(sender, proxyUsername, expected)
      })
    })

    // Bot-like type edge cases
    const botLikeTypes = [
      {
        type: 'robot',
        description: 'type that contains bot but is not exactly bot'
      },
      {
        type: 'botuser',
        description: 'type that contains bot but is not exactly bot (suffix)'
      }
    ]

    botLikeTypes.forEach(({ type, description }) => {
      automatedSenderTests.shouldReturnFalse(
        `should return false for ${description}`,
        createSender('user', type)
      )
    })
  })

  describe('combined scenarios', () => {
    automatedSenderTests.shouldReturnTrue(
      'should return true when sender is both bot and proxy user',
      createSender('proxy-user', 'bot')
    )

    automatedSenderTests.shouldReturnTrue(
      'should prioritize bot detection over proxy detection',
      createSender('different-user', 'bot')
    )
  })
})
