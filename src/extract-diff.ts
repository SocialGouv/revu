import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

interface ExtractDiffOptions {
  repositoryUrl: string;
  branch: string;
  tempFolder?: string;
}

interface ExtractDiffFromRepoOptions {
  branch: string;
  repoPath: string;
}

async function getDefaultBranch(repoPath: string): Promise<string> {
  try {
    // Try to get the default branch from the remote
    const { stdout } = await execAsync('git symbolic-ref refs/remotes/origin/HEAD', { cwd: repoPath });
    return stdout.trim().replace('refs/remotes/origin/', '');
  } catch {
    // If that fails, try common default branch names
    for (const branch of ['main', 'master', 'dev']) {
      try {
        await execAsync(`git show-ref --verify refs/remotes/origin/${branch}`, { cwd: repoPath });
        return branch;
      } catch {
        continue;
      }
    }
    throw new Error('Could not determine default branch');
  }
}

export async function extractDiffFromRepo({
  branch,
  repoPath
}: ExtractDiffFromRepoOptions): Promise<string> {
  // Get the default branch name
  const defaultBranch = await getDefaultBranch(repoPath);
  
  // Generate and return the diff between the default branch and the specified branch
  const { stdout } = await execAsync(`git diff origin/${defaultBranch}...origin/${branch}`, { 
    cwd: repoPath,
    maxBuffer: 10 * 1024 * 1024 // 10MB buffer for large diffs
  });
  
  return stdout;
}

// Keep original function for backward compatibility
export async function extractDiff({
  repositoryUrl,
  branch,
  tempFolder = path.join(os.tmpdir(), 'revu-diff-' + Date.now())
}: ExtractDiffOptions): Promise<string> {
  try {
    // Create temporary directory
    await fs.mkdir(tempFolder, { recursive: true });
    
    // Clone the repository with all branches
    await execAsync(`git clone ${repositoryUrl} ${tempFolder}`);
    
    // Extract diff using the new function
    const diff = await extractDiffFromRepo({
      branch,
      repoPath: tempFolder
    });
    
    // Clean up
    await fs.rm(tempFolder, { recursive: true, force: true });
    
    return diff;
  } catch (error) {
    // Clean up on error
    try {
      await fs.rm(tempFolder, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error('Error during cleanup:', cleanupError);
    }
    
    throw error;
  }
}
