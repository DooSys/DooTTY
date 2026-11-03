import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const project = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(project, 'src/locales');
const files = (await readdir(directory)).filter(name => name.endsWith('.json'));
function flatten(object, prefix = '', result = {}) {
  for (const [key, value] of Object.entries(object)) {
    if (key === '_meta') continue;
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string' && value.trim()) result[full] = value;
    else if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, full, result);
    else throw new Error(`${full}: expected a nonempty translation string`);
  }
  return result;
}
const catalogs = new Map();
for (const file of files) {
  if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]+)*\.json$/.test(file)) throw new Error(`Invalid locale filename: ${file}`);
  const json = JSON.parse(await readFile(path.join(directory, file), 'utf8'));
  if (typeof json._meta?.name !== 'string' || !json._meta.name.trim()) throw new Error(`${file}: missing _meta.name`);
  catalogs.set(file, flatten(json));
}
const base = catalogs.get('en.json');
if (!base) throw new Error('en.json is the required fallback catalog');
const placeholders = value => [...value.matchAll(/{{\s*([\w.]+)\s*}}/g)].map(match => match[1]).sort().join(',');
for (const [file, catalog] of catalogs) {
  for (const key of Object.keys(base)) {
    if (!(key in catalog)) throw new Error(`${file}: missing ${key}`);
    if (placeholders(catalog[key]) !== placeholders(base[key])) throw new Error(`${file}: placeholder mismatch for ${key}`);
    if (/<\/?[a-z][^>]*>/i.test(catalog[key])) throw new Error(`${file}: HTML is not allowed in ${key}`);
  }
  for (const key of Object.keys(catalog)) if (!(key in base)) throw new Error(`${file}: unknown key ${key}`);
}
const html = await readFile(path.join(project, 'index.html'), 'utf8');
for (const match of html.matchAll(/data-i18n(?:-(?:aria-label|title|placeholder|alt))?="([^"]+)"/g)) {
  if (!(match[1] in base)) throw new Error(`index.html: unknown translation key ${match[1]}`);
}
for (const file of ['main.ts','select.ts','settings.ts','transport.ts','wsl-management.ts','wsl-updates.ts','monitoring.ts']) {
  const source = await readFile(path.join(project, 'src', file), 'utf8');
  for (const match of source.matchAll(/\bt\("([\w.]+)"/g)) {
    if (!(match[1] in base)) throw new Error(`${file}: unknown translation key ${match[1]}`);
  }
}
console.log(`${files.length} locales checked; ${Object.keys(base).length} keys each, placeholders and UI references valid.`);
