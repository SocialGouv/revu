import path from 'path'
import { simpleGit } from 'simple-git'
import Handlebars from 'handlebars'
import { promises as fs } from 'fs'
import { execSync } from 'child_process'
import { Anthropic } from '@anthropic-ai/sdk'
import { Context } from 'probot'
// import { PullRequest } from '@octokit/webhooks-types';

// Helper function to truncate text while preserving structure
function truncateText(text: string, maxLines: number): string {
  const lines = text.split('\n')
  if (lines.length <= maxLines) return text
  
  const halfLines = Math.floor(maxLines / 2)
  const firstHalf = lines.slice(0, halfLines)
  const secondHalf = lines.slice(-halfLines)
  
  return [...firstHalf, `\n... (${lines.length - maxLines} lines omitted) ...\n`, ...secondHalf].join('\n')
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
})

const PROMPT_TEMPLATE = await fs.readFile(
  path.join(process.cwd(), 'templates/prompt.hbs'),
  'utf8'
)
const template = Handlebars.compile(PROMPT_TEMPLATE)

type PullRequestContext = Context<
  'pull_request.opened' | 'pull_request.synchronize'
>

export default async function handlePullRequest(
  context: PullRequestContext
): Promise<void> {
  console.log('🤖 Starting PR review process...')
  const pr = context.payload.pull_request
  const repoName = context.payload.repository.name
  const repoOwner = context.payload.repository.owner.login
  const prNumber = pr.number
  const baseBranch = pr.base.ref
  const headBranch = pr.head.ref

  console.log(`📋 PR Details:
  - Repository: ${repoOwner}/${repoName}
  - PR Number: ${prNumber}
  - Base Branch: ${baseBranch}
  - Head Branch: ${headBranch}
  `)

  // Create temp directory for cloning
  const tmpDir = path.join(
    process.env.REPOSITORY_FOLDER || '',
    `${repoName}-${prNumber}`
  )
  await fs.mkdir(tmpDir, { recursive: true })

  try {
    console.log(`📁 Created temporary directory: ${tmpDir}`)

    // Clone repository and fetch branches
    console.log('🔄 Cloning repository...')
    const git = simpleGit({ baseDir: process.cwd() })
    await git.clone(pr.head.repo.clone_url, tmpDir)
    console.log('✅ Repository cloned successfully')
    
    // Change to repo directory and fetch all branches
    console.log('🔄 Fetching branches...')
    const repoGit = simpleGit({ baseDir: tmpDir })
    await repoGit.fetch(['--all'])
    await repoGit.checkout(headBranch)
    await repoGit.fetch('origin', baseBranch)
    console.log('✅ Branches fetched successfully')

    // Get source tree using ai-digest with limits
    console.log('📊 Generating source tree...')
    const sourceTree = execSync(
      `cd ${tmpDir} && npx ai-digest -o source_tree.md .`,
      { 
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 10 // 10MB buffer
      }
    )
    // const sourceTreeContent = truncateText(
    //   await fs.readFile(path.join(tmpDir, 'source_tree.md'), 'utf8'),
    //   1000 // Max lines for source tree
    // )
    const sourceTreeContent = await fs.readFile(path.join(tmpDir, 'source_tree.md'), 'utf8')
    console.log('✅ Source tree generated')

    // Get diff using code2prompt with increased buffer and truncation
    console.log('🔍 Generating diff...')
    // let diffOutput: string
    let rawDiffContent: string
    try {
      const rawDiff = execSync(
        `cd ${tmpDir} && code2prompt . --git-diff-branch '${baseBranch}, ${headBranch}' --output=rawdiff.txt`,
        {
          encoding: 'utf8',
          maxBuffer: 1024 * 1024 * 10 // 10MB buffer
        }
      )
      // diffOutput = truncateText(rawDiff, 2000) // Max lines for diff
      rawDiffContent = await fs.readFile(path.join(tmpDir, 'rawdiff.txt'), 'utf8')
      
      console.log('✅ Diff generated')
    } catch (error) {
      console.warn('⚠️ Failed to generate diff:', error)
      // diffOutput = 'Failed to generate diff due to buffer limitations'
      rawDiffContent = 'Failed to generate diff due to buffer limitations'
    }

    // Get git log using full remote branch references with limit
    console.log('📜 Retrieving git log...')
    const gitLog = execSync(
      `cd ${tmpDir} && git log -n 50 origin/${baseBranch}..origin/${headBranch} --pretty=format:"%h - %s (%an)"`,
      { 
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 10 // 10MB buffer
      }
    )

    console.log('✅ Git log retrieved')

    // Generate prompt
    console.log('📝 Generating review prompt...')
    const prompt = template({
      absolute_code_path: tmpDir,
      source_tree: sourceTreeContent,
      // git_diff_branch: diffOutput,
      git_diff_branch: rawDiffContent,
      git_log_branch: gitLog,
    })
    console.log('✅ Review prompt generated')

    // Call Claude API
    console.log('🤖 Requesting review from Claude API...')
    const completion = await anthropic.messages.create({
      model: 'claude-3-sonnet-20240229',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      system:
        'You are a code reviewer. Provide constructive feedback on the pull request.',
    })

    console.log('✅ Received review from Claude API')

    // Extract review text from completion
    const reviewText = completion.content.reduce((text, block) => {
      if (block.type === 'text') {
        return text + block.text
      }
      return text
    }, '')

    // Post review comment
    console.log('💬 Posting review comment...')
    await context.octokit.pulls.createReview({
      owner: repoOwner,
      repo: repoName,
      pull_number: prNumber,
      body: reviewText || 'No review content available',
      event: 'COMMENT',
    })
    console.log('✅ Review comment posted successfully')
  } catch (error) {
    console.error('❌ Error processing PR:', error)

    // Post error comment
    await context.octokit.pulls.createReview({
      owner: repoOwner,
      repo: repoName,
      pull_number: prNumber,
      body: `Error processing PR review: ${error instanceof Error ? error.message : String(error)}`,
      event: 'COMMENT',
    })
  } finally {
    // Cleanup
    console.log('🧹 Cleaning up temporary files...')
    await fs.rm(tmpDir, { recursive: true, force: true })
    console.log('✅ Cleanup completed')
    console.log('🏁 PR review process completed')
  }
}
