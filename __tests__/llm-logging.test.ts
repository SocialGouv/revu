import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock console.log to capture log outputs
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})

// Mock environment variables before importing the module
vi.stubEnv('LOG_LLM_EXCHANGES', 'metadata')

import {
  logLLMRequestSent,
  logLLMResponseReceived,
  logLLMRequestFailed
} from '../src/utils/logger.ts'

describe('LLM Logging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('logLLMRequestSent', () => {
    it('should log request with metadata level', () => {
      const prompt = 'Test prompt'
      const model = 'claude-sonnet-4-20250514'
      const strategyName = 'line-comments'
      const context = { pr_number: 123, repository: 'test/repo' }

      logLLMRequestSent(prompt, model, strategyName, context)

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('"event_type":"llm_request_sent"')
      )
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('"model_used":"claude-sonnet-4-20250514"')
      )
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('"strategy_name":"line-comments"')
      )
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('"pr_number":123')
      )
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('"repository":"test/repo"')
      )
    })

    it('should include prompt preview in truncated mode', () => {
      const longPrompt = 'a'.repeat(1000)
      const model = 'claude-sonnet-4-20250514'
      const strategyName = 'line-comments'

      // Mock environment to use truncated mode
      vi.stubEnv('LOG_LLM_EXCHANGES', 'truncated')

      logLLMRequestSent(longPrompt, model, strategyName)

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('"prompt_preview"')
      )
    })
  })

  describe('logLLMResponseReceived', () => {
    it('should log response with duration and token usage', () => {
      const response = '{"summary": "Test response"}'
      const model = 'claude-sonnet-4-20250514'
      const strategyName = 'line-comments'
      const durationMs = 1500
      const tokensUsed = { input: 100, output: 50 }
      const context = { pr_number: 123, repository: 'test/repo' }

      logLLMResponseReceived(
        response,
        model,
        strategyName,
        durationMs,
        tokensUsed,
        context
      )

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('"event_type":"llm_response_received"')
      )
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('"request_duration_ms":1500')
      )
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('"tokens_used":{"input":100,"output":50}')
      )
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('"pr_number":123')
      )
    })

    it('should truncate long responses in truncated mode', () => {
      const longResponse = 'b'.repeat(1000)
      const model = 'claude-sonnet-4-20250514'
      const strategyName = 'line-comments'
      const durationMs = 1500

      // Mock environment to use truncated mode
      vi.stubEnv('LOG_LLM_EXCHANGES', 'truncated')

      logLLMResponseReceived(longResponse, model, strategyName, durationMs)

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('"response_preview"')
      )
    })
  })

  describe('logLLMRequestFailed', () => {
    it('should log request failure with error details', () => {
      const error = new Error('API request failed')
      const model = 'claude-sonnet-4-20250514'
      const strategyName = 'line-comments'
      const context = { pr_number: 123, repository: 'test/repo' }

      logLLMRequestFailed(error, model, strategyName, context)

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('"event_type":"llm_request_failed"')
      )
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('"level":"error"')
      )
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('"error_message":"API request failed"')
      )
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('"pr_number":123')
      )
    })
  })

  describe('Log levels', () => {
    it('should not log when disabled', () => {
      vi.stubEnv('LOG_LLM_EXCHANGES', 'disabled')

      logLLMRequestSent('test', 'claude-sonnet-4-20250514', 'line-comments')

      expect(mockConsoleLog).not.toHaveBeenCalled()
    })

    it('should log only metadata when in metadata mode', () => {
      vi.stubEnv('LOG_LLM_EXCHANGES', 'metadata')

      const prompt = 'Test prompt'
      logLLMRequestSent(prompt, 'claude-sonnet-4-20250514', 'line-comments')

      const logCall = mockConsoleLog.mock.calls[0][0]
      expect(logCall).not.toContain('"prompt_preview"')
      expect(logCall).not.toContain('"full_prompt"')
    })

    it('should include full content in full mode', () => {
      vi.stubEnv('LOG_LLM_EXCHANGES', 'full')

      const prompt = 'Test prompt'
      logLLMRequestSent(prompt, 'claude-sonnet-4-20250514', 'line-comments')

      const logCall = mockConsoleLog.mock.calls[0][0]
      expect(logCall).toContain('"full_prompt"')
      expect(logCall).toContain('"prompt_preview"')
    })
  })
})
