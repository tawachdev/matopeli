import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

function version() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
  } catch {
    return 'local';
  }
}

const hashed = [];
for (const f of readdirSync(join(dist, '_astro'))) {
  if (f.endsWith('.js') || f.endsWith('.css')) hashed.push('/_astro/' + f);
}

const CORE = ['./', './index.html', './engine.wasm'];
const fingerprint = [...CORE.slice(1), ...hashed]
  .map((a) => {
    const p = join(dist, a.slice(1));
    return a + ':' + statSync(p).size;
  })
  .join('|');
const ver = version() + '-' + createHash('sha1').update(fingerprint).digest('hex').slice(0, 7);

const template = readFileSync(join(root, 'public', 'sw.js'), 'utf8');
const out = template
  .replace('__MATOPELI_VERSION__', ver)
  .replace('/*__MATOPELI_ASSETS__*/', hashed.map((a) => `'${a}'`).join(', '));
writeFileSync(join(dist, 'sw.js'), out);
console.log(`sw.js: version ${ver}, precache ${3 + hashed.length} assets`);
