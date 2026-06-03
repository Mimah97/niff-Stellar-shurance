/**
 * Generates backend/src/graphql/persisted-query-allowlist.json from every
 * *.graphql / *.gql file found under the search roots (frontend src, and any
 * other directories listed in SEARCH_ROOTS).
 *
 * Each file's trimmed content is hashed with SHA-256, producing a JSON map of
 * { "<sha256>": "<query body>" } that the PersistedQueryMiddleware loads at
 * startup to enforce the allowlist in production.
 *
 * Usage (from the backend directory):
 *   npm run allowlist:generate
 *
 * In CI, run this script then check for drift with:
 *   git diff --exit-code src/graphql/persisted-query-allowlist.json
 */
import { createHash } from 'crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

const BACKEND_ROOT = resolve(__dirname, '..');
const PROJECT_ROOT = resolve(BACKEND_ROOT, '..');

// Directories (relative to the project root) to scan for .graphql / .gql files.
const SEARCH_ROOTS = ['frontend/src'];

function findGraphqlFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      results.push(...findGraphqlFiles(full));
    } else if (entry.endsWith('.graphql') || entry.endsWith('.gql')) {
      results.push(full);
    }
  }
  return results;
}

const allowlist: Record<string, string> = {};

for (const relRoot of SEARCH_ROOTS) {
  const absRoot = join(PROJECT_ROOT, relRoot);
  const files = findGraphqlFiles(absRoot);
  for (const file of files) {
    const body = readFileSync(file, 'utf-8').trim();
    const hash = createHash('sha256').update(body).digest('hex');
    allowlist[hash] = body;
  }
}

const outPath = join(BACKEND_ROOT, 'src/graphql/persisted-query-allowlist.json');
writeFileSync(outPath, JSON.stringify(allowlist, null, 2) + '\n', 'utf-8');

const count = Object.keys(allowlist).length;
console.log(`persisted-query-allowlist.json: ${count} entr${count === 1 ? 'y' : 'ies'} written to ${outPath}`);
