#!/usr/bin/env node

import type { Octokit } from '@octokit/rest'
import axios from 'axios'
import chalk from 'chalk'
import { program } from 'commander'
import * as dotenv from 'dotenv'
import type { PlatformContext } from '../core/models/platform-types.ts'
import {
  performCompleteReview,
  type ReviewResult,
  type ValidationIssue,
  type ValidationResult
} from '../core/services/review-service.ts'
import { createMinimalContext } from '../github/context-builder.ts'
import {
  createGithubAppOctokit,
  generateInstallationToken
} from '../github/utils.ts'
import { createPlatformContextFromGitHub } from '../platforms/github/github-adapter.ts'
import { logSystemError } from '../utils/logger.ts'
import { shouldProcessBranch } from '../config-handler.ts'

// Load environment variables
dotenv.config()

type BranchName = string

interface CliReviewContext {
  owner: string
  repo: string
  prNumber: number
  repositoryUrl: string
  headBranch: string
  octokit: Octokit
}

interface PrDetails {
  title: string
  body: string | null
}
/**
 * Parse a GitHub PR URL and extract owner, repo, and PR number
 * @param url GitHub PR URL in the format https://github.com/{owner}/{repo}/pull/{number}
 * @returns Object containing owner, repo, and PR number
 * @throws Error if URL format is invalid
 */
function parsePrUrl(url: string): {
  owner: string
  repo: string
  prNumber: number
} {
  // Match URLs in the format https://github.com/{owner}/{repo}/pull/{number}
  const regex = /https:\/\/github\.com\/([^\\/]+)\/([^\\/]+)\/pull\/(\d+)/
  const match = url.match(regex)

  if (!match) {
    throw new Error(
      'Invalid GitHub PR URL. Expected format: https://github.com/{owner}/{repo}/pull/{number}'
    )
  }

  const [, owner, repo, prNumberStr] = match
  const prNumber = parseInt(prNumberStr, 10)

  return { owner, repo, prNumber }
}
/**
 * Create review context with all necessary GitHub data
 * @param prUrl GitHub PR URL
 * @param authResult Authentication result
 * @returns Complete review context
 */
async function createReviewContext(
  prNumber: number,
  repoRef: { owner: string; repo: string }
): Promise<CliReviewContext> {
  const { owner, repo } = repoRef

  console.log(chalk.gray(`📁 Repository: ${owner}/${repo}, PR: #${prNumber}`))

  // Create Octokit instance with GitHub App authentication
  const octokit = await createGithubAppOctokit(owner, repo)

  // Fetch PR details
  console.log(chalk.gray('⚡ Fetching PR details from GitHub...'))
  const headBranch = await fetchPrBranch(owner, repo, prNumber, octokit)
  console.log(chalk.gray(`🌿 Head branch: ${headBranch}`))

  // Construct repository URL
  const repositoryUrl = `https://github.com/${owner}/${repo}.git`

  return {
    owner,
    repo,
    prNumber,
    repositoryUrl,
    headBranch,
    octokit
  }
}

/**
 * Fetch PR details (title and body)
 * @param context Review context
 * @returns PR details
 */
async function fetchPrDetails(context: CliReviewContext): Promise<PrDetails> {
  const { owner, repo, prNumber, octokit } = context

  try {
    const prResponse = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber
    })
    return {
      title: prResponse.data.title,
      body: prResponse.data.body
    }
  } catch (error) {
    console.warn(
      chalk.yellow(`⚠ Could not fetch PR details: ${error.message}`)
    )
    return {
      title: '',
      body: null
    }
  }
}

/**
 * Fetch head branch from GitHub API
 * @param owner Repository owner
 * @param repo Repository name
 * @param prNumber PR number
 * @param octokit Octokit instance
 * @returns PR head branch
 * @throws Error if PR cannot be fetched
 */
async function fetchPrBranch(
  owner: string,
  repo: string,
  prNumber: number,
  octokit: Octokit
): Promise<BranchName> {
  try {
    // Get PR details
    const { data: prData } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber
    })

    const headBranch = prData.head.ref

    if (!headBranch) {
      throw new Error('Could not determine head branch from PR')
    }

    return headBranch
  } catch (error) {
    logSystemError(error, {
      pr_number: prNumber,
      repository: repo,
      context_msg: 'Failed to fetch PR branch'
    })
    if (axios.isAxiosError(error) && error.response) {
      if (error.response.status === 404) {
        throw new Error(
          `PR #${prNumber} not found in ${owner}/${repo}. Make sure the PR exists and you have access to it.`
        )
      } else if (
        error.response.status === 401 ||
        error.response.status === 403
      ) {
        throw new Error(
          `Authentication error. Please check your GitHub App credentials.`
        )
      } else {
        throw new Error(
          `GitHub API error: ${error.response.status} ${error.response.statusText}`
        )
      }
    }
    throw error
  }
}

/**
 * Display successful review results
 * @param result Review result
 * @param submit Whether comments were submitted
 */
function displaySuccessResults(result: ReviewResult, submit: boolean): void {
  if (!submit && result.analysis) {
    // Display analysis when not submitting
    console.log(chalk.green('\n=== 📋 PR Analysis Results ===\n'))
    console.log(result.analysis)
    console.log(chalk.green('\n=== ✅ End of Analysis ===\n'))
  }
  console.log(chalk.green(`✅ ${result.message}`))
}

/**
 * Display validation errors
 * @param validationResult Validation result with issues
 */
function displayValidationErrors(validationResult: ValidationResult): void {
  console.log(chalk.yellow('\n⚠️  PR Validation Failed'))
  validationResult.issues.forEach((issue: ValidationIssue, index: number) => {
    console.log(chalk.yellow(`${index + 1}. ${issue.reason}`))
    console.log(chalk.gray(`   💡 ${issue.suggestion}`))
  })
}

/**
 * Handle ReviewResult that indicates failure
 * @param result ReviewResult with failure state
 */
function handleReviewFailure(result: ReviewResult): void {
  if (result.error) {
    console.error(chalk.red(`❌ ${result.error}`))
    process.exit(1)
  } else if (result.message) {
    console.log(chalk.yellow(`⚠️  ${result.message}`))
    // Don't exit for warnings/validation failures
  } else {
    console.error(chalk.red(`❌ Review failed with unknown error`))
    process.exit(1)
  }
}

/**
 * Handle Error objects from exceptions
 * @param error Error object
 */
function handleReviewException(error: Error): void {
  console.error(chalk.red(`❌ Error: ${error.message}`))
  process.exit(1)
}

/**
 * Create platform context from review context and PR details
 * @param context Review context
 * @param prDetails PR details
 * @param token Authentication token
 * @returns Platform context
 */
async function createPlatformContext(
  context: CliReviewContext,
  prDetails: PrDetails,
  token?: string
): Promise<PlatformContext> {
  const { owner, repo, prNumber, octokit } = context
  const { title, body } = prDetails

  const githubContext = await createMinimalContext(owner, repo, octokit)
  return createPlatformContextFromGitHub(
    githubContext,
    prNumber,
    title,
    body || undefined,
    token
  )
}

/**
 * Review a PR by URL using the same logic as the production bot
 * @param prUrl GitHub PR URL
 * @param submit Whether to submit comments to GitHub
 * @param strategy Review strategy to use
 */
async function reviewPr(
  prUrl: string,
  submit: boolean,
  strategy?: string
): Promise<void> {
  console.log(chalk.blue(`🔍 Reviewing PR: ${prUrl}`))
  console.log(chalk.gray('⚡ Parsing PR URL...'))

  try {
    const { owner, repo, prNumber } = parsePrUrl(prUrl)
    // Step 1: Create review context (no token needed yet)
    const context = await createReviewContext(prNumber, { owner, repo })

    // Step 2: Branch filter via .revu.yml (fail-open handled inside helper)
    const decision = await shouldProcessBranch(context.headBranch)
    if (!decision.allowed) {
      console.log(
        chalk.yellow(
          'Branch filtered by .revu.yml (branches) — skipping review.'
        )
      )
      return
    }

    // Step 3: Fetch PR details
    const prDetails = await fetchPrDetails(context)

    // Step 4: Create platform context
    // Generate installation token to access private repositories (aligns with webhook flow)
    const installationToken = await generateInstallationToken(
      context.owner,
      context.repo
    )
    const platformContext = await createPlatformContext(
      context,
      prDetails,
      installationToken
    )
    // Step 5: Perform review
    const result = await performCompleteReview(
      context.repositoryUrl,
      context.prNumber,
      context.headBranch,
      platformContext,
      {
        submitComments: submit,
        reviewType: 'on-demand',
        repository: `${context.owner}/${context.repo}`,
        strategy
      }
    )

    // Step 7: Handle results
    if (result.success) {
      displaySuccessResults(result, submit)
    } else {
      // Handle validation failure or other errors
      if (result.validationResult && !result.validationResult.isValid) {
        displayValidationErrors(result.validationResult)
      }
      handleReviewFailure(result)
    }
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error))
    handleReviewException(errorObj)
  }
}

// Set up command-line interface
program
  .name('review-pr')
  .description('Review a GitHub PR by URL using Claude AI')
  .version('1.0.0')
  .argument('<pr-url>', 'GitHub PR URL to review')
  .option(
    '-s, --strategy <strategy>',
    'Review strategy to use',
    'line-comments'
  )
  .option('--submit', 'Submit comments to GitHub after analysis', false)
  .action(
    async (prUrl: string, options: { strategy: string; submit: boolean }) => {
      const submit = options.submit
      const strategy = options.strategy

      await reviewPr(prUrl, submit, strategy)
    }
  )

// Parse command-line arguments
program.parse(process.argv)
