import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

interface ExtractLogOptions {
  repositoryUrl: string;
  branch: string;
  tempFolder?: string;
}

export async function extractLog({
  repositoryUrl,
  branch,
  tempFolder = path.join(os.tmpdir(), 'revu-log-' + Date.now())
}: ExtractLogOptions): Promise<string> {
  try {
    // Create temporary directory
    await fs.mkdir(tempFolder, { recursive: true });
    
    // Clone the repository
    await execAsync(`git clone ${repositoryUrl} ${tempFolder}`);
    
    // Fetch all branches
    await execAsync('git fetch --all', { cwd: tempFolder });
    
    // Generate and return the git log for the specified branch
    const { stdout } = await execAsync(
      `git log origin/${branch} --pretty=format:"%h - %an, %ar : %s"`, 
      { 
        cwd: tempFolder,
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer for large logs
      }
    );
    
    // Clean up
    await fs.rm(tempFolder, { recursive: true, force: true });
    
    return stdout;
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
