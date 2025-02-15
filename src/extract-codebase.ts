import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

interface ExtractCodebaseOptions {
  repositoryUrl: string;
  branch: string;
  tempFolder?: string;
}

interface ExtractCodebaseFromRepoOptions {
  branch: string;
  repoPath: string;
}

export async function extractCodebaseFromRepo({
  branch,
  repoPath
}: ExtractCodebaseFromRepoOptions): Promise<string> {
  try {
    // Checkout the branch
    await execAsync(`git checkout ${branch}`, { cwd: repoPath });
    
    // Copy the .aidigestignore file to the repository
    await fs.copyFile('.aidigestignore', path.join(repoPath, '.aidigestignore'));
    
    // Create a temporary file for the output
    const tempOutputFile = path.join(repoPath, 'codebase.md');
    
    // Run ai-digest on the repository
    await execAsync(
      `npx ai-digest --input ${repoPath} --output ${tempOutputFile}`
    );
    
    // Read the generated file
    const codebase = await fs.readFile(tempOutputFile, 'utf-8');
    
    // Clean up the temporary file
    await fs.rm(tempOutputFile);
    await fs.rm(path.join(repoPath, '.aidigestignore'));
    
    return codebase;
  } catch (error) {
    throw error;
  }
}

// Keep original function for backward compatibility
export async function extractCodebase({
  repositoryUrl,
  branch,
  tempFolder = path.join(os.tmpdir(), 'ai-digest-' + Date.now())
}: ExtractCodebaseOptions): Promise<string> {
  try {
    // Create temporary directory
    await fs.mkdir(tempFolder, { recursive: true });
    
    // Clone the repository
    await execAsync(`git clone --branch ${branch} ${repositoryUrl} ${tempFolder}`);
    
    // Extract codebase using the new function
    const codebase = await extractCodebaseFromRepo({
      branch,
      repoPath: tempFolder
    });
    
    // Clean up
    await fs.rm(tempFolder, { recursive: true, force: true });
    
    return codebase;
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
