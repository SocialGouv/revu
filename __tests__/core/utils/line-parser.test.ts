import { describe, expect, it } from 'vitest'
import {
  isLineInfoInDiff,
  parseLineString
} from '../../../src/core/utils/line-parser.ts'

describe('parseLineString', () => {
  it('should parse single line numbers correctly', () => {
    const result = parseLineString('123')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.lineInfo.isRange).toBe(false)
      expect(result.lineInfo.startLine).toBe(123)
      expect(result.lineInfo.endLine).toBeUndefined()
    }
  })

  it('should parse line ranges correctly', () => {
    const result = parseLineString('123-125')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.lineInfo.isRange).toBe(true)
      expect(result.lineInfo.startLine).toBe(123)
      expect(result.lineInfo.endLine).toBe(125)
    }
  })

  it('should handle invalid single line numbers', () => {
    const result = parseLineString('abc')
    expect(result.success).toBe(false)
    expect(result).toEqual({ success: false, reason: 'invalid_numbers' })
  })

  it('should handle invalid range line numbers', () => {
    const result = parseLineString('123-abc')
    expect(result.success).toBe(false)
    expect(result).toEqual({ success: false, reason: 'invalid_numbers' })
  })

  it('should handle empty string', () => {
    const result = parseLineString('')
    expect(result.success).toBe(false)
    expect(result).toEqual({ success: false, reason: 'invalid_format' })
  })

  it('should handle malformed ranges', () => {
    const result = parseLineString('123-')
    expect(result.success).toBe(false)
    expect(result).toEqual({ success: false, reason: 'invalid_numbers' })
  })
})

describe('isLineInfoInDiff', () => {
  it('should return false when fileInfo is undefined', () => {
    const lineInfo = { isRange: false, startLine: 123 }
    const result = isLineInfoInDiff(lineInfo, undefined)
    expect(result).toBe(false)
  })

  it('should return true for single line in diff', () => {
    const lineInfo = { isRange: false, startLine: 123 }
    const fileInfo = { changedLines: new Set([123, 124, 125]) }
    const result = isLineInfoInDiff(lineInfo, fileInfo)
    expect(result).toBe(true)
  })

  it('should return false for single line not in diff', () => {
    const lineInfo = { isRange: false, startLine: 126 }
    const fileInfo = { changedLines: new Set([123, 124, 125]) }
    const result = isLineInfoInDiff(lineInfo, fileInfo)
    expect(result).toBe(false)
  })

  it('should return true for range completely in diff', () => {
    const lineInfo = { isRange: true, startLine: 123, endLine: 125 }
    const fileInfo = { changedLines: new Set([123, 124, 125, 126]) }
    const result = isLineInfoInDiff(lineInfo, fileInfo)
    expect(result).toBe(true)
  })

  it('should return false for range partially in diff', () => {
    const lineInfo = { isRange: true, startLine: 123, endLine: 126 }
    const fileInfo = { changedLines: new Set([123, 124, 125]) }
    const result = isLineInfoInDiff(lineInfo, fileInfo)
    expect(result).toBe(false)
  })

  it('should return false for range not in diff', () => {
    const lineInfo = { isRange: true, startLine: 127, endLine: 129 }
    const fileInfo = { changedLines: new Set([123, 124, 125]) }
    const result = isLineInfoInDiff(lineInfo, fileInfo)
    expect(result).toBe(false)
  })

  it('should handle invalid ranges where start > end', () => {
    const result = parseLineString('125-123')
    expect(result.success).toBe(false)
    expect(result).toEqual({ success: false, reason: 'invalid_range' })
  })

  it('should handle very large line numbers', () => {
    const result = parseLineString('999999999')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.lineInfo.startLine).toBe(999999999)
    }
  })
})
