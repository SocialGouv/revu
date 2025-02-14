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
    
    // Copy the .aidigestignore file to the cloned repository
    await fs.copyFile('.aidigestignore', path.join(tempFolder, '.aidigestignore'));
    
    // Create a temporary file for the output
    const tempOutputFile = path.join(tempFolder, 'codebase.md');
    
    // Run ai-digest on the cloned repository
    await execAsync(
      `npx ai-digest --input ${tempFolder} --output ${tempOutputFile}`
    );
    
    // Read the generated file
    const codebase = await fs.readFile(tempOutputFile, 'utf-8');
    
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
