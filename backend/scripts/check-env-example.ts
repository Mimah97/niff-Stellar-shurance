import { readFileSync } from 'fs';
import { join } from 'path';
import { renderEnvExample, renderEnvDocs } from '../src/config/env.definitions';

const root = join(__dirname, '..');
let failed = false;

const envExamplePath = join(root, '.env.example');
const expectedExample = renderEnvExample();
const actualExample = readFileSync(envExamplePath, 'utf8');
if (actualExample !== expectedExample) {
  console.error('.env.example is out of date. Run `npm run env:example:generate` in backend/.');
  failed = true;
} else {
  console.log('.env.example is up to date.');
}

const docsPath = join(root, 'docs', 'environment-variables.md');
const expectedDocs = renderEnvDocs();
const actualDocs = readFileSync(docsPath, 'utf8');
if (actualDocs !== expectedDocs) {
  console.error('docs/environment-variables.md is out of date. Run `npm run env:example:generate` in backend/.');
  failed = true;
} else {
  console.log('docs/environment-variables.md is up to date.');
}

if (failed) process.exit(1);
