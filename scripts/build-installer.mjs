/** Package the verified native binary with the same NSIS script locally and on CI. */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const version = JSON.parse(readFileSync('package.json')).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('A stable three-part version is required');
const binary = path.resolve(process.argv[2] || 'src-tauri/target/release/DooTTY.exe');
const python = process.platform === 'win32' ? 'python' : 'python3';
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${command} failed (${result.status})`);
}
run(python, ['scripts/verify-windows.py', '--binary', binary]);
const output = path.resolve('.local/releases', version);
const payload = path.resolve('.local/installer', version, 'payload');
rmSync(payload, { recursive: true, force: true });
mkdirSync(payload, { recursive: true });
mkdirSync(output, { recursive: true });
cpSync(binary, path.join(payload, 'DooTTY.exe'));
for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.txt']) {
  cpSync(name, path.join(payload, name), { recursive: true });
}
// Detailed provenance stays in the source repository; the required full notices remain offline.
writeFileSync(path.join(payload, 'THIRD_PARTY.md'), `# Licences DooTTY / DooTTY licenses

DooTTY is licensed under MIT: see [LICENSE](LICENSE).

Third-party software, artwork and installer terms are preserved in
[THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt), including all distinct
copyright and attribution notices. Identical texts are included once and referenced.

Full component inventory, original source notices and graphic credits:
[GitHub — DooTTY ${version}](https://github.com/DooSys/DooTTY/tree/v${version}/licenses)
and [third-party documentation](https://github.com/DooSys/DooTTY/blob/v${version}/THIRD_PARTY.md).
`);
const defaults = JSON.parse(readFileSync('config.example.json'));
for (const language of ['fr', 'en']) {
  writeFileSync(path.join(payload, `default-${language}.json`), JSON.stringify({ ...defaults, language }, null, 2) + '\n');
}
function inventory(directory, prefix = '') {
  return readdirSync(directory).sort().flatMap(name => {
    const relative = path.posix.join(prefix, name);
    return statSync(path.join(directory, name)).isDirectory()
      ? inventory(path.join(directory, name), relative) : [relative];
  });
}
const files = inventory(payload).filter(name => !/^default-(?:en|fr)\.json$/.test(name));
// Reject NSIS syntax in paths before writing a generated include.
const literal = value => { if (/["$\r\n]/.test(value)) throw Error('Unsupported NSIS path'); return value; };
const installed = value => literal(value).replaceAll('/', '\\');
const dirs = [...new Set(files.map(f => path.posix.dirname(f)).filter(d => d !== '.'))];
const noticeText = readFileSync('THIRD_PARTY_NOTICES.txt', 'utf8').replaceAll('\r\n', '\n');
const legacyFiles = inventory(path.resolve('licenses'));
for (const file of legacyFiles.filter(name => /\.(?:txt|md)$/i.test(name))) {
  const original = readFileSync(path.join('licenses', file), 'utf8').replaceAll('\r\n', '\n').trimEnd();
  if (!noticeText.includes(original)) throw Error(`Consolidated notices are missing licenses/${file}; regenerate them before packaging`);
}
for (const entry of JSON.parse(readFileSync('licenses/dependencies.json')).packages) {
  if (!noticeText.includes(`${entry.name} ${entry.version} [${entry.ecosystem}]`)) throw Error(`Missing component attribution: ${entry.name}`);
}
const legacyDirs = [...new Set(legacyFiles.map(f => path.posix.dirname(f)).filter(d => d !== '.'))].sort((a,b)=>b.length-a.length);
const manifest = path.resolve('.local/installer', version, 'payload.nsh');
writeFileSync(manifest, [
  '!macro InstallPayload',
  'SetOutPath "$INSTDIR"',
  `File /oname=DooTTY.next.exe "${literal(path.join(payload, 'DooTTY.exe'))}"`,
  ...['.', ...dirs].flatMap(dir => [
    `SetOutPath "$INSTDIR${dir === '.' ? '' : '\\' + installed(dir)}"`,
    ...files.filter(f => f !== 'DooTTY.exe' && path.posix.dirname(f) === dir).map(f => `File "${literal(path.join(payload, f))}"`),
  ]), '!macroend', '!macro RemovePayload',
  ...files.map(f => `Delete "$INSTDIR\\${installed(f)}"`),
  ...dirs.sort((a, b) => b.length - a.length).map(d => `RMDir "$INSTDIR\\${installed(d)}"`),
  '!macroend', '!macro RemoveLegacyNotices',
  ...legacyFiles.map(f => `Delete "$INSTDIR\\licenses\\${installed(f)}"`),
  ...legacyDirs.map(d => `RMDir "$INSTDIR\\licenses\\${installed(d)}"`),
  'RMDir "$INSTDIR\\licenses"',
  'ClearErrors', // A retained user file may prevent removal of an otherwise obsolete folder.
  '!macroend', '',
].join('\n'));
const setup = path.join(output, `DooTTY-${version}-setup.exe`);
const compiler = process.env.MAKENSIS || (process.platform === 'win32'
  ? path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'NSIS', 'makensis.exe') : 'makensis');
const definitions = {
  VERSION: version, PAYLOAD: payload, OUTFILE: setup, APP_ICON: path.resolve('src-tauri/icons/icon.ico'),
  MANIFEST: manifest, SIZE_KB: Math.ceil(files.reduce((sum, file) => sum + statSync(path.join(payload, file)).size, 0) / 1024),
};
const option = process.platform === 'win32' ? '/' : '-';
// Unicode output does not determine how makensis decodes BOM-less source files.
// Windows otherwise uses its ANSI code page and corrupts our French UTF-8 strings.
run(compiler, [`${option}INPUTCHARSET`, 'UTF8', `${option}WX`, `${option}V2`, ...Object.entries(definitions).map(([key, value]) => `${option}D${key}=${value}`), 'installer/dootty.nsi']);
if (!existsSync(setup)) throw Error('Installer was not produced');
run(python, ['scripts/verify-windows.py', '--installer', '--binary', setup]);
const data = readFileSync(setup);
console.log(`Installer: ${setup} (${data.length.toLocaleString()} bytes)`);
