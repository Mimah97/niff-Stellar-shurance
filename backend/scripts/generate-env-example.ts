import { writeFileSync } from 'fs';
import { join } from 'path';
import { renderEnvExample, renderEnvDocs } from '../src/config/env.definitions';

const root = join(__dirname, '..');

const envExamplePath = join(root, '.env.example');
writeFileSync(envExamplePath, renderEnvExample(), 'utf8');
console.log(`Wrote ${envExamplePath}`);

const docsPath = join(root, 'docs', 'environment-variables.md');
writeFileSync(docsPath, renderEnvDocs(), 'utf8');
console.log(`Wrote ${docsPath}`);
