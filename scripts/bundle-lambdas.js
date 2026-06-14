/**
 * Bundles each Lambda handler into a self-contained file using esbuild.
 * Output: packages/lambdas/bundle/<function-name>/index.js
 *
 * Each bundle includes all dependencies (including @eventforge/shared)
 * but externalizes @aws-sdk/* (provided by Lambda Node.js 20 runtime).
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const lambdasDir = path.resolve(__dirname, '..', 'packages', 'lambdas');
const bundleDir = path.join(lambdasDir, 'bundle');

const handlers = [
  { entry: 'src/workflow/validate-order.ts', name: 'validate-order' },
  { entry: 'src/workflow/reserve-inventory.ts', name: 'reserve-inventory' },
  { entry: 'src/workflow/charge-payment.ts', name: 'charge-payment' },
  { entry: 'src/workflow/confirm-order.ts', name: 'confirm-order' },
  { entry: 'src/workflow/release-inventory.ts', name: 'release-inventory' },
  { entry: 'src/workflow/order-failed.ts', name: 'order-failed' },
  { entry: 'src/processors/email-processor.ts', name: 'email-processor' },
  { entry: 'src/processors/pdf-processor.ts', name: 'pdf-processor' },
  { entry: 'src/processors/webhook-processor.ts', name: 'webhook-processor' },
  { entry: 'src/ingestion/webhook-ingest.ts', name: 'webhook-ingest' },
];

// Clean bundle directory
if (fs.existsSync(bundleDir)) {
  fs.rmSync(bundleDir, { recursive: true });
}

for (const handler of handlers) {
  const outDir = path.join(bundleDir, handler.name);
  fs.mkdirSync(outDir, { recursive: true });

  const entryPath = path.join(lambdasDir, handler.entry);
  const cmd = [
    'npx esbuild',
    `"${entryPath}"`,
    '--bundle',
    '--platform=node',
    '--target=node20',
    '--format=cjs',
    '--minify',
    '--external:@aws-sdk/*',
    `--outfile="${path.join(outDir, 'index.js')}"`,
  ].join(' ');

  console.log(`Bundling ${handler.name}...`);
  execSync(cmd, { stdio: 'inherit', cwd: lambdasDir });
}

console.log(`\nAll ${handlers.length} handlers bundled to packages/lambdas/bundle/`);
