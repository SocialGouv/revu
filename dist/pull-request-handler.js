import path from 'path';
import { simpleGit } from 'simple-git';
import Handlebars from 'handlebars';
import { promises as fs } from 'fs';
import { execSync } from 'child_process';
import { Anthropic } from '@anthropic-ai/sdk';
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY || '',
});
const PROMPT_TEMPLATE = await fs.readFile(path.join(process.cwd(), 'templates/prompt.hbs'), 'utf8');
const template = Handlebars.compile(PROMPT_TEMPLATE);
export default async function handlePullRequest(context) {
    const pr = context.payload.pull_request;
    const repoName = context.payload.repository.name;
    const repoOwner = context.payload.repository.owner.login;
    const prNumber = pr.number;
    const baseBranch = pr.base.ref;
    const headBranch = pr.head.ref;
    // Create temp directory for cloning
    const tmpDir = path.join(process.env.REPOSITORY_FOLDER || '', `${repoName}-${prNumber}`);
    await fs.mkdir(tmpDir, { recursive: true });
    try {
        // Clone repository
        const git = simpleGit({ baseDir: process.cwd() });
        await git.clone(pr.head.repo.clone_url, tmpDir);
        // Get source tree using ai-digest
        const sourceTree = execSync(`ai-digest ${tmpDir}`, { encoding: 'utf8' });
        // Get diff using code2prompt
        const diffOutput = execSync(`cd ${tmpDir} && code2prompt diff ${baseBranch} ${headBranch}`, { encoding: 'utf8' });
        // Get git log
        const gitLog = execSync(`cd ${tmpDir} && git log ${baseBranch}..${headBranch} --pretty=format:"%h - %s (%an)"`, { encoding: 'utf8' });
        // Generate prompt
        const prompt = template({
            absolute_code_path: tmpDir,
            source_tree: sourceTree,
            git_diff_branch: diffOutput,
            git_log_branch: gitLog
        });
        // Call Claude API
        const completion = await anthropic.messages.create({
            model: 'claude-3-sonnet-20240229',
            max_tokens: 4096,
            messages: [{
                    role: 'user',
                    content: prompt
                }],
            system: "You are a code reviewer. Provide constructive feedback on the pull request."
        });
        // Post review comment
        await context.octokit.pulls.createReview({
            owner: repoOwner,
            repo: repoName,
            pull_number: prNumber,
            body: completion.content[0].type === 'text' ? completion.content[0].text : 'No review content available',
            event: 'COMMENT'
        });
    }
    catch (error) {
        console.error('Error processing PR:', error);
        // Post error comment
        await context.octokit.pulls.createReview({
            owner: repoOwner,
            repo: repoName,
            pull_number: prNumber,
            body: `Error processing PR review: ${error instanceof Error ? error.message : String(error)}`,
            event: 'COMMENT'
        });
    }
    finally {
        // Cleanup
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
}
