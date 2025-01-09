import path from 'path';
import { simpleGit } from 'simple-git';
import Handlebars from 'handlebars';
import { promises as fs } from 'fs';
import { execSync } from 'child_process';
import { Anthropic } from '@anthropic-ai/sdk';
// import { PullRequest } from '@octokit/webhooks-types';
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY || '',
});
const PROMPT_TEMPLATE = await fs.readFile(path.join(process.cwd(), 'templates/prompt.hbs'), 'utf8');
const template = Handlebars.compile(PROMPT_TEMPLATE);
export default async function handlePullRequest(context) {
    console.log('🤖 Starting PR review process...');
    const pr = context.payload.pull_request;
    const repoName = context.payload.repository.name;
    const repoOwner = context.payload.repository.owner.login;
    const prNumber = pr.number;
    const baseBranch = pr.base.ref;
    const headBranch = pr.head.ref;
    console.log(`📋 PR Details:
  - Repository: ${repoOwner}/${repoName}
  - PR Number: ${prNumber}
  - Base Branch: ${baseBranch}
  - Head Branch: ${headBranch}
  `);
    // Create temp directory for cloning
    const tmpDir = path.join(process.env.REPOSITORY_FOLDER || '', `${repoName}-${prNumber}`);
    await fs.mkdir(tmpDir, { recursive: true });
    try {
        console.log(`📁 Created temporary directory: ${tmpDir}`);
        // Clone repository
        console.log('🔄 Cloning repository...');
        const git = simpleGit({ baseDir: process.cwd() });
        await git.clone(pr.head.repo.clone_url, tmpDir);
        console.log('✅ Repository cloned successfully');
        // Get source tree using ai-digest
        console.log('📊 Generating source tree...');
        const sourceTree = execSync(`ai-digest ${tmpDir}`, { encoding: 'utf8' });
        console.log('✅ Source tree generated');
        // Get diff using code2prompt
        console.log('🔍 Generating diff...');
        const diffOutput = execSync(`cd ${tmpDir} && code2prompt diff ${baseBranch} ${headBranch}`, {
            encoding: 'utf8',
        });
        console.log('✅ Diff generated');
        // Get git log
        console.log('📜 Retrieving git log...');
        const gitLog = execSync(`cd ${tmpDir} && git log ${baseBranch}..${headBranch} --pretty=format:"%h - %s (%an)"`, { encoding: 'utf8' });
        console.log('✅ Git log retrieved');
        // Generate prompt
        console.log('📝 Generating review prompt...');
        const prompt = template({
            absolute_code_path: tmpDir,
            source_tree: sourceTree,
            git_diff_branch: diffOutput,
            git_log_branch: gitLog,
        });
        console.log('✅ Review prompt generated');
        // Call Claude API
        console.log('🤖 Requesting review from Claude API...');
        const completion = await anthropic.messages.create({
            model: 'claude-3-sonnet-20240229',
            max_tokens: 4096,
            messages: [
                {
                    role: 'user',
                    content: prompt,
                },
            ],
            system: 'You are a code reviewer. Provide constructive feedback on the pull request.',
        });
        console.log('✅ Received review from Claude API');
        // Post review comment
        console.log('💬 Posting review comment...');
        await context.octokit.pulls.createReview({
            owner: repoOwner,
            repo: repoName,
            pull_number: prNumber,
            body: completion.content[0].type === 'text'
                ? completion.content[0].text
                : 'No review content available',
            event: 'COMMENT',
        });
        console.log('✅ Review comment posted successfully');
    }
    catch (error) {
        console.error('❌ Error processing PR:', error);
        // Post error comment
        await context.octokit.pulls.createReview({
            owner: repoOwner,
            repo: repoName,
            pull_number: prNumber,
            body: `Error processing PR review: ${error instanceof Error ? error.message : String(error)}`,
            event: 'COMMENT',
        });
    }
    finally {
        // Cleanup
        console.log('🧹 Cleaning up temporary files...');
        await fs.rm(tmpDir, { recursive: true, force: true });
        console.log('✅ Cleanup completed');
        console.log('🏁 PR review process completed');
    }
}
