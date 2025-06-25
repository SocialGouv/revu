import { describe, expect, it } from 'vitest'
import { isPRDraft } from '../src/github/reviewer-utils.ts'

describe('Draft PR Handling', () => {
  describe('isPRDraft', () => {
    it('should return true when PR is in draft status', () => {
      const draftPR = { draft: true }
      expect(isPRDraft(draftPR)).toBe(true)
    })

    it('should return false when PR is not in draft status', () => {
      const readyPR = { draft: false }
      expect(isPRDraft(readyPR)).toBe(false)
    })

    it('should return false when draft property is undefined', () => {
      const prWithoutDraft = {} as { draft: boolean }
      expect(isPRDraft(prWithoutDraft)).toBe(false)
    })
  })
})
