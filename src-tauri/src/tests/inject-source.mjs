import { readdirSync, readFileSync } from 'node:fs';

// The page script exactly as build.rs joins it: every src/inject/*.js in
// file-name order inside one function. Keep this wrapper identical to the one
// in build.rs.
const dir = new URL('../inject/', import.meta.url);

export const parts = readdirSync(dir).filter((name) => name.endsWith('.js')).sort();

export const part = (name) => readFileSync(new URL(name, dir), 'utf8');

export const script = `(() => {\n${parts
  .map((name) => `// ---- ${name}\n${part(name).trimEnd()}\n`)
  .join('')}})();\n`;
