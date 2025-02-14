import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

async function main() {
  try {
    // First, clone the repository
    console.log('Cloning repository...');
    await execAsync('git clone --branch ai-digest https://github.com/SocialGouv/carnets.git temp-carnets');
    
    // Create output directory if it doesn't exist
    await fs.mkdir('output', { recursive: true });
    
    // Copy the .aidigestignore file to the cloned repository
    console.log('Copying .aidigestignore file...');
    await fs.copyFile('.aidigestignore', 'temp-carnets/.aidigestignore');
    
    // Run ai-digest on the cloned repository
    console.log('Running ai-digest...');
    const { stdout, stderr } = await execAsync(
      'npx ai-digest --input temp-carnets --output output/codebase.md --show-output-files'
    );
    
    console.log('ai-digest output:', stdout);
    if (stderr) console.error('ai-digest errors:', stderr);
    
    // Clean up the temporary repository
    console.log('Cleaning up...');
    await fs.rm('temp-carnets', { recursive: true, force: true });
    
    console.log('Extraction completed!');
    console.log('Output saved to: output/codebase.md');
  } catch (error) {
    console.error('Error during extraction:', error);
    process.exit(1);
  }
}

main();
