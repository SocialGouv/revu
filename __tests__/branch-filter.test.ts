import { describe, it, expect, vi } from 'vitest'
import {
  isBranchAllowed,
  normalizeBranch,
  type BranchFilterConfig
} from '../src/core/utils/branch-filter.ts'
import * as logger from '../src/utils/logger.ts'

describe('branch-filter (patterns only, last match wins)', () => {
  describe('normalizeBranch', () => {
    it('removes refs/heads/ prefix', () => {
      expect(normalizeBranch('refs/heads/feature/foo')).toBe('feature/foo')
    })

    it('returns branch unchanged if no prefix', () => {
      expect(normalizeBranch('main')).toBe('main')
      expect(normalizeBranch('release/1.2.3')).toBe('release/1.2.3')
    })
  })

  describe('default behavior', () => {
    it('allows any branch when cfg is undefined', () => {
      expect(isBranchAllowed('main', undefined)).toBe(true)
      expect(isBranchAllowed('feature/x', undefined)).toBe(true)
    })

    it('allows any branch when patterns are missing or empty', () => {
      const emptyA: BranchFilterConfig = {}
      const emptyB: BranchFilterConfig = { patterns: [] }
      expect(isBranchAllowed('main', emptyA)).toBe(true)
      expect(isBranchAllowed('feature/x', emptyB)).toBe(true)
    })
  })

  describe('baseline: default-allow', () => {
    it('denies targeted branches via negation', () => {
      const cfg: BranchFilterConfig = {
        patterns: ['**', '!wip/**', '!regex:/^throwaway\\//']
      }
      expect(isBranchAllowed('main', cfg)).toBe(true)
      expect(isBranchAllowed('wip/foo', cfg)).toBe(false)
      expect(isBranchAllowed('throwaway/tmp', cfg)).toBe(false)
      expect(isBranchAllowed('feature/bar', cfg)).toBe(true)
    })
  })

  describe('baseline: default-deny (allow-list)', () => {
    it('allows only explicitly allowed branches', () => {
      const cfg: BranchFilterConfig = {
        patterns: ['!**', 'main', 'release/*', 'regex:/^hotfix\\/\\d+$/i']
      }
      expect(isBranchAllowed('main', cfg)).toBe(true)
      expect(isBranchAllowed('release/1.2.3', cfg)).toBe(true)
      expect(isBranchAllowed('hotfix/123', cfg)).toBe(true)
      expect(isBranchAllowed('HotFix/456', cfg)).toBe(true)
      expect(isBranchAllowed('feature/foo', cfg)).toBe(false)
      expect(isBranchAllowed('hotfix/x', cfg)).toBe(false)
    })
  })

  describe('last match wins', () => {
    it('applies the later deny over earlier allow', () => {
      const cfg: BranchFilterConfig = {
        patterns: ['release/**', '!release/bad/*']
      }
      expect(isBranchAllowed('release/1.2.3', cfg)).toBe(true)
      expect(isBranchAllowed('release/bad/1', cfg)).toBe(false)
    })

    it('applies later allow over earlier deny', () => {
      const cfg: BranchFilterConfig = {
        patterns: ['!**', 'release/**']
      }
      expect(isBranchAllowed('release/1.2.3', cfg)).toBe(true)
      expect(isBranchAllowed('feature/foo', cfg)).toBe(false)
    })
  })

  describe('glob semantics via picomatch', () => {
    it('* matches a single segment; ** matches across segments', () => {
      const single: BranchFilterConfig = { patterns: ['!**', 'release/*'] }
      expect(isBranchAllowed('release/1.2', single)).toBe(true)
      expect(isBranchAllowed('release/major/1', single)).toBe(false)

      const multi: BranchFilterConfig = { patterns: ['!**', 'release/**'] }
      expect(isBranchAllowed('release/1.2', multi)).toBe(true)
      expect(isBranchAllowed('release/major/1', multi)).toBe(true)
    })

    it('? matches a single character', () => {
      const cfg: BranchFilterConfig = { patterns: ['!**', 'hot?ix/*'] }
      expect(isBranchAllowed('hotfix/1', cfg)).toBe(true)
      expect(isBranchAllowed('hotxix/2', cfg)).toBe(true)
      expect(isBranchAllowed('hotfixx/3', cfg)).toBe(false)
    })
  })

  describe('refs/heads prefix handling', () => {
    it('accepts branches with refs/heads/ prefix', () => {
      const cfg: BranchFilterConfig = { patterns: ['!**', 'main'] }
      expect(isBranchAllowed('refs/heads/main', cfg)).toBe(true)
    })
  })

  describe('warning behavior', () => {
    it('logs a warning and ignores malformed regex pattern', () => {
      const spy = vi.spyOn(logger, 'logSystemWarning')
      const cfg: BranchFilterConfig = { patterns: ['!**', 'regex:/['] }
      expect(isBranchAllowed('main', cfg)).toBe(false) // no allow matched; still default-deny due to '!**'
      expect(spy).toHaveBeenCalledOnce()
      spy.mockRestore()
    })

    it('logs a warning and ignores invalid glob pattern', () => {
      const spy = vi.spyOn(logger, 'logSystemWarning')
      const cfg: BranchFilterConfig = { patterns: ['!**', '[invalid'] }
      expect(isBranchAllowed('main', cfg)).toBe(false)
      expect(spy).toHaveBeenCalled()
      spy.mockRestore()
    })
  })
})
