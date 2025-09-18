import { describe, it, expect } from 'vitest'
import {
  isBranchAllowed,
  normalizeBranch,
  type BranchFilterConfig
} from '../src/core/utils/branch-filter.ts'

describe('branch-filter', () => {
  describe('normalizeBranch', () => {
    it('should remove refs/heads/ prefix', () => {
      expect(normalizeBranch('refs/heads/feature/foo')).toBe('feature/foo')
    })

    it('should return branch unchanged if no prefix', () => {
      expect(normalizeBranch('main')).toBe('main')
      expect(normalizeBranch('release/1.2.3')).toBe('release/1.2.3')
    })
  })

  describe('isBranchAllowed - default (no config)', () => {
    it('should allow any branch when config is undefined', () => {
      expect(isBranchAllowed('main', undefined)).toBe(true)
      expect(isBranchAllowed('feature/x', undefined)).toBe(true)
    })
  })

  describe('isBranchAllowed - mode: allow', () => {
    it('should allow branches that match an allow glob pattern', () => {
      const cfg: BranchFilterConfig = {
        mode: 'allow',
        allow: ['main', 'release/*']
      }
      expect(isBranchAllowed('main', cfg)).toBe(true)
      expect(isBranchAllowed('release/1.2.3', cfg)).toBe(true)
    })

    it('should deny branches that do not match any allow pattern', () => {
      const cfg: BranchFilterConfig = {
        mode: 'allow',
        allow: ['main', 'release/*']
      }
      expect(isBranchAllowed('feature/foo', cfg)).toBe(false)
      expect(isBranchAllowed('hotfix/123', cfg)).toBe(false)
    })

    it('should support allow regex patterns with regex:/.../ syntax', () => {
      const cfg: BranchFilterConfig = {
        mode: 'allow',
        allow: ['regex:/^hotfix\\/\\d+$/i']
      }
      expect(isBranchAllowed('hotfix/123', cfg)).toBe(true)
      expect(isBranchAllowed('HotFix/456', cfg)).toBe(true) // case-insensitive
      expect(isBranchAllowed('hotfix/x', cfg)).toBe(false)
    })
  })

  describe('isBranchAllowed - mode: deny (default-allow)', () => {
    it('should deny branches that match a deny glob pattern', () => {
      const cfg: BranchFilterConfig = {
        mode: 'deny',
        deny: ['wip/*', 'experimental/**']
      }
      expect(isBranchAllowed('wip/foo', cfg)).toBe(false)
      expect(isBranchAllowed('experimental/a/b', cfg)).toBe(false)
    })

    it('should allow branches that do not match any deny pattern', () => {
      const cfg: BranchFilterConfig = { mode: 'deny', deny: ['wip/*'] }
      expect(isBranchAllowed('main', cfg)).toBe(true)
      expect(isBranchAllowed('feature/bar', cfg)).toBe(true)
    })

    it('should support deny regex patterns with regex:/.../ syntax', () => {
      const cfg: BranchFilterConfig = {
        mode: 'deny',
        deny: ['regex:/^throwaway\\//']
      }
      expect(isBranchAllowed('throwaway/test', cfg)).toBe(false)
      expect(isBranchAllowed('feature/throwaway', cfg)).toBe(true)
    })
  })

  describe('deny precedence', () => {
    it('should deny when both allow and deny match (deny wins)', () => {
      const cfg: BranchFilterConfig = {
        mode: 'allow',
        allow: ['release/**'],
        deny: ['release/bad/*']
      }
      expect(isBranchAllowed('release/1.2.3', cfg)).toBe(true)
      expect(isBranchAllowed('release/bad/1', cfg)).toBe(false)
    })
  })

  describe('glob semantics via ignore library', () => {
    it('should treat * as single path-segment wildcard and ** as multi-segment', () => {
      // * matches one segment after the slash
      const allowSingle: BranchFilterConfig = {
        mode: 'allow',
        allow: ['release/*']
      }
      expect(isBranchAllowed('release/1.2', allowSingle)).toBe(true)
      expect(isBranchAllowed('release/major/1', allowSingle)).toBe(false)

      // ** matches across segments
      const allowMulti: BranchFilterConfig = {
        mode: 'allow',
        allow: ['release/**']
      }
      expect(isBranchAllowed('release/1.2', allowMulti)).toBe(true)
      expect(isBranchAllowed('release/major/1', allowMulti)).toBe(true)
    })

    it('should support ? wildcard', () => {
      const cfg: BranchFilterConfig = { mode: 'allow', allow: ['hot?ix/*'] }
      expect(isBranchAllowed('hotfix/1', cfg)).toBe(true)
      expect(isBranchAllowed('hotxix/2', cfg)).toBe(true)
      expect(isBranchAllowed('hotfixx/3', cfg)).toBe(false)
    })
  })

  describe('refs/heads prefix handling', () => {
    it('should accept branches with refs/heads/ prefix', () => {
      const cfg: BranchFilterConfig = { mode: 'allow', allow: ['main'] }
      expect(isBranchAllowed('refs/heads/main', cfg)).toBe(true)
    })
  })
})
