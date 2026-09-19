import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

function run(cmd: string): string {
  console.log(`Executing in ${rootDir}: ${cmd}`);
  return execSync(cmd, { cwd: rootDir, encoding: 'utf-8', stdio: ['inherit', 'pipe', 'pipe'] }).trim();
}

async function main() {
  console.log('--- Measuring Docker Image Sizes (Naive Single-Stage vs Multi-Stage) ---');

  // Build naive single-stage image
  console.log('\nBuilding single-stage image (collab-canvas:naive)...');
  run('docker build -t collab-canvas:naive -f Dockerfile.naive .');

  // Build multi-stage image
  console.log('\nBuilding multi-stage image (collab-canvas:prod)...');
  run('docker build -t collab-canvas:prod -f Dockerfile .');

  // Retrieve sizes
  const naiveSize = run('docker images --format "{{.Size}}" collab-canvas:naive');
  const prodSize = run('docker images --format "{{.Size}}" collab-canvas:prod');

  console.log(`\nMeasured Image Sizes:`);
  console.log(`  collab-canvas:naive (Single-stage): ${naiveSize}`);
  console.log(`  collab-canvas:prod  (Multi-stage):  ${prodSize}`);

  // Update docs/BENCHMARKS.md
  const docPath = path.resolve(rootDir, 'docs/BENCHMARKS.md');
  if (fs.existsSync(docPath)) {
    let content = fs.readFileSync(docPath, 'utf-8');

    content = content.replace(
      '| `collab-canvas:naive` | Single-stage build | TBD (run `npm run bench`) | Includes full dev dependencies, typescript, compilers |',
      `| \`collab-canvas:naive\` | Single-stage build | ${naiveSize} | Includes full dev dependencies, typescript, compilers |`
    );

    content = content.replace(
      '| `collab-canvas:prod` | Multi-stage build | TBD (run `npm run bench`) | Minimal Alpine runtime, pruned production dependencies, non-root user |',
      `| \`collab-canvas:prod\` | Multi-stage build | ${prodSize} | Minimal Alpine runtime, pruned production dependencies, non-root user |`
    );

    content = content.replace(
      'Single-Stage vs Multi-Stage Docker Image Size: TBD (run `npm run bench`)',
      `Single-Stage vs Multi-Stage Docker Image Size: Measured (${prodSize} vs ${naiveSize})`
    );

    fs.writeFileSync(docPath, content, 'utf-8');
    console.log(`\nUpdated docs/BENCHMARKS.md with actual measured image sizes.`);
  }
}

main().catch((err) => {
  console.error('Docker measurement error:', err);
  process.exit(1);
});
