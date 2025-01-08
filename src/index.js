import { Anthropic } from '@anthropic-ai/sdk';
import simpleGit from 'simple-git';
import Handlebars from 'handlebars';
import { execSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const PROMPT_TEMPLATE = await fs.readFile(
  path.join(process.cwd(), 'templates/prompt.hbs'),
  'utf8'
);
const template = Handlebars.compile(PROMPT_TEMPLATE);

/**
 * @param {import('probot').Probot} app
 */
export default function (app) {
  app.on(['pull_request.opened', 'pull_request.synchronize'], async (context) => {
    const pr = context.payload.pull_request;
    const repoName = context.payload.repository.name;
    const repoOwner = context.payload.repository.owner.login;
    const prNumber = pr.number;
    const baseBranch = pr.base.ref;
    const headBranch = pr.head.ref;

    // Create temp directory for cloning
    const tmpDir = path.join(process.cwd(), 'tmp', `${repoName}-${prNumber}`);
    await fs.mkdir(tmpDir, { recursive: true });

    try {
      // Clone repository
      const git = simpleGit();
      await git.clone(pr.head.repo.clone_url, tmpDir);
      
      // Get source tree using ai-digest
      const sourceTree = execSync(`ai-digest ${tmpDir}`, { encoding: 'utf8' });

      // Get diff using code2prompt
      const diffOutput = execSync(
        `cd ${tmpDir} && code2prompt diff ${baseBranch} ${headBranch}`,
        { encoding: 'utf8' }
      );

      // Get git log
      const gitLog = execSync(
        `cd ${tmpDir} && git log ${baseBranch}..${headBranch} --pretty=format:"%h - %s (%an)"`,
        { encoding: 'utf8' }
      );

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
        }]
      });

      // Post review comment
      await context.octokit.pulls.createReview({
        owner: repoOwner,
        repo: repoName,
        pull_number: prNumber,
        body: completion.content[0].text,
        event: 'COMMENT'
      });

    } catch (error) {
      console.error('Error processing PR:', error);
      
      // Post error comment
      await context.octokit.pulls.createReview({
        owner: repoOwner,
        repo: repoName,
        pull_number: prNumber,
        body: `Error processing PR review: ${error.message}`,
        event: 'COMMENT'
      });
    } finally {
      // Cleanup
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
}
