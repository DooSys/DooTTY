/** Inspect the exact tracked + unignored working files without staging or changing Git. */
import { spawnSync } from 'node:child_process';
import { readFile, lstat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const project = fileURLToPath(new URL('../', import.meta.url));
let scratch;
function git(args, options = {}) {
  const result = spawnSync('git', ['-c', 'core.excludesFile=', ...args], { cwd: project, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  return result;
}
try {
  const top = git(['rev-parse', '--show-toplevel']);
  let prefix = [];
  if (top.status !== 0 || path.resolve(top.stdout.trim()) !== path.resolve(project)) {
    scratch = await mkdtemp(path.join(tmpdir(), 'dootty-public-'));
    const initialized = git(['init', '--bare', '--template=', scratch]);
    if (initialized.status !== 0) throw new Error('Cannot initialize the temporary Git inventory');
    prefix = [`--git-dir=${scratch}`, `--work-tree=${project}`];
  }
  const inventory = git([...prefix, 'ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  if (inventory.status !== 0) throw new Error('Cannot read the public file inventory');
  const files = [...new Set(inventory.stdout.split('\0').filter(Boolean))].sort();
  const failures = [];
  const dependencyInventory = JSON.parse(await readFile(path.join(project, 'licenses/dependencies.json'), 'utf8'));
  for (const [filename, property] of [['src-tauri/Cargo.lock', 'cargo_lock_sha256'], ['package-lock.json', 'npm_lock_sha256']]) {
    if (createHash('sha256').update(await readFile(path.join(project, filename))).digest('hex') !== dependencyInventory[property]) failures.push(`${filename}: dependency notices need regeneration`);
  }
  const manifest = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'));
  const tauri = JSON.parse(await readFile(path.join(project, 'src-tauri/tauri.conf.json'), 'utf8'));
  const cargoVersion = (await readFile(path.join(project, 'src-tauri/Cargo.toml'), 'utf8')).match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if ([tauri.version, cargoVersion, dependencyInventory.version].some(version => version !== manifest.version)) failures.push('Project version mismatch between npm, Cargo, Tauri or notices');
  const privatePath = /(?:^|\/)(?:\.local|\.aws|\.codex|\.agents|\.git|\.idea|\.vscode|node_modules|dist|target|gen|__pycache__)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|(?:^|\/)config\.json$|\.(?:exe|dll|zip|pfx|p12|pem|key|log|pyc)$|:Zone\.Identifier$/i;
  const patterns = [
    ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['GitHub credential', /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/],
    ['AWS access identifier', /(?:AKIA|ASIA)[A-Z0-9]{16}/],
    ['credential in URL', /https?:\/\/[^\s/@:]+:[^\s/@]+@/],
  ];
  const privateUserPath = /(?:\/home\/|[A-Za-z]:\\+(?:Users|Documents and Settings)\\+)(?!(?:developer|example|user|username)(?:[\\/\s"'`]|$))[^\s"'`/\\]+/;
  for (const filename of files) {
    if (privatePath.test(filename) && filename !== '.env.example') { failures.push(`${filename}: private/generated file`); continue; }
    const full = path.join(project, filename);
    const stat = await lstat(full);
    if (!stat.isFile()) { failures.push(`${filename}: symlink or unsupported file type`); continue; }
    if (stat.size > 8 * 1024 * 1024) { failures.push(`${filename}: unexpectedly large file`); continue; }
    const bytes = await readFile(full);
    if (/\.(?:png|ico)$/i.test(filename)) continue;
    const text = bytes.toString('utf8');
    for (const [name, pattern] of patterns) if (pattern.test(text)) failures.push(`${filename}: possible ${name}`);
    // Third-party copyright/license notices retain their upstream attribution verbatim.
    if (!filename.startsWith('licenses/') && filename !== 'THIRD_PARTY_NOTICES.txt' && privateUserPath.test(text)) failures.push(`${filename}: personal home path`);
    if (filename.endsWith('.md')) {
      for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
        const destination = match[1].replace(/^<|>$/g, '').split('#')[0];
        if (!destination || /^(?:https?:|mailto:)/.test(destination)) continue;
        const target = path.relative(project, path.resolve(path.dirname(full), destination)).replaceAll(path.sep, '/');
        if (!files.includes(target)) failures.push(`${filename}: link outside the public inventory (${destination})`);
      }
    }
  }
  for (const filename of ['.local/probe.txt', '.aws/credentials', '.codex/auth.json', '.env', 'config.json', 'src-tauri/target/probe.exe']) {
    if (git([...prefix, 'check-ignore', '--no-index', '-q', filename]).status !== 0) failures.push(`${filename}: missing ignore protection`);
  }
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else if (process.argv.includes('--list-json')) {
    console.log(JSON.stringify(files, null, 2));
  } else {
    console.log(`${files.length} public files checked: no private/generated paths, known credential patterns or personal home paths; local Markdown links resolve.`);
    console.log(scratch ? 'Working files inspected with an isolated temporary Git inventory; no repository history available.' : 'Tracked files included: accidentally tracked private files are checked too.');
  }
} finally {
  if (scratch) await rm(scratch, { recursive: true, force: true });
}
