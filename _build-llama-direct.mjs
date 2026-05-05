// Direct build script - bypasses yargs CLI entirely
import { pathToFileURL } from 'url';
import { join } from 'path';

const nlcBase = join(process.cwd(), 
  'node_modules/.pnpm/node-llama-cpp@3.18.1_typescript@5.9.3/node_modules/node-llama-cpp');
const distBase = join(nlcBase, 'dist');

async function importLocal(relativePath) {
  return import(pathToFileURL(join(distBase, relativePath)).href);
}

async function main() {
  console.log('[build] Starting direct llama.cpp build (bypassing yargs CLI)...');
  
  const { BuildLlamaCppCommand } = await importLocal('cli/commands/source/commands/BuildCommand.js');
  
  console.log('[build] Calling BuildLlamaCppCommand with gpu=auto...');
  
  await BuildLlamaCppCommand({
    gpu: 'auto',
    noUsageExample: true,
    noCustomCmakeBuildOptionsInBinaryFolderName: false,
    ciMode: false
  });
  
  console.log('[build] Build completed successfully!');
}

main().catch(err => {
  console.error('[build] FAILED:', err);
  process.exit(1);
});
