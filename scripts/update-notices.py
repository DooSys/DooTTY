"""Generate reproducible third-party notices from installed packages and Windows Cargo metadata.

Create metadata with: cargo metadata --locked --format-version 1 --features custom-protocol --filter-platform
x86_64-pc-windows-msvc --manifest-path src-tauri/Cargo.toml > windows-metadata.json
Then pass --metadata windows-metadata.json. The metadata file is development-only:
its absolute paths are never copied into the public inventory.
"""
import argparse
import hashlib
import json
from pathlib import Path

project = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--metadata', type=Path, required=True)
args = parser.parse_args()
metadata = json.loads(args.metadata.read_text(encoding='utf-8'))
resolved = {item['id'] for item in metadata['resolve']['nodes']}
supplemental_root = project / 'licenses/supplemental'
supplemental = {(item['name'], item['version']): item for item in json.loads((supplemental_root / 'sources.json').read_text())}
entries = []
notices = ['DooTTY — Third-party notices\n\nThis inventory includes the Windows Rust dependency graph (including build tools)\nand the JavaScript runtime dependency closure. Inclusion does not imply that every\nlisted package is linked into the executable. Upstream license expressions and\nnotices are preserved; DooTTY\'s MIT license does not replace them.\n']

def add(name, version, license_name, source, root=None, license_file=None, ecosystem='rust'):
    texts = []
    files = []
    if root:
        files = [file for file in root.iterdir() if file.is_file() and file.name.upper().startswith(('LICENSE', 'LICENCE', 'COPYING', 'NOTICE', 'COPYRIGHT', 'AUTHORS'))]
        if license_file:
            file = root / license_file
            if file.is_file() and file not in files:
                files.append(file)
        for file in sorted(files):
            texts.append((file.name, file.read_text(encoding='utf-8')))
    extra = supplemental.get((name, version))
    if extra:
        file = supplemental_root / extra['file']
        if hashlib.sha256(file.read_bytes()).hexdigest() != extra['sha256']:
            raise ValueError(f'Supplemental notice hash mismatch: {file.name}')
        texts.append((extra['file'], file.read_text(encoding='utf-8')))
    if not texts:
        raise ValueError(f'Missing upstream notice: {name} {version}')
    entries.append({'name': name, 'version': version, 'ecosystem': ecosystem, 'license': license_name,
                    'source': source, 'notice_files': [name for name, _ in texts],
                    **({'supplemental_source': extra['url']} if extra else {})})
    notices.append(f'\n{"=" * 72}\n{name} {version} [{ecosystem}]\nLicense: {license_name}\nSource: {source}\n')
    for filename, text in texts:
        notices.append(f'\n--- {filename} ---\n{text.rstrip()}\n')

for item in sorted(metadata['packages'], key=lambda p: (p['name'], p['version'])):
    if item['id'] not in resolved or item['name'] == 'dootty':
        continue
    add(item['name'], item['version'], item['license'], f"https://crates.io/api/v1/crates/{item['name']}/{item['version']}/download",
        Path(item['manifest_path']).parent, item['license_file'])

pending = list(json.loads((project / 'package.json').read_text())['dependencies'])
seen = set()
while pending:
    name = pending.pop(0)
    if name in seen:
        continue
    seen.add(name)
    root = project / 'node_modules' / name
    item = json.loads((root / 'package.json').read_text())
    pending.extend(sorted(item.get('dependencies', {})))
    add(name, item['version'], item['license'], f"https://www.npmjs.com/package/{name}/v/{item['version']}", root, ecosystem='npm')

sdk = supplemental.get(('Microsoft.Web.WebView2 SDK loader', '1.0.3800.47'))
if not sdk:
    raise ValueError('Missing the license of the statically linked WebView2 SDK loader')
bindings = next(item for item in metadata['packages'] if item['name'] == 'webview2-com-sys' and item['id'] in resolved)
loader = Path(bindings['manifest_path']).parent / 'x64/WebView2LoaderStatic.lib'
if hashlib.sha256(loader.read_bytes()).hexdigest() != sdk['loader_sha256']:
    raise ValueError('WebView2 SDK loader changed: review its version and upstream license before regenerating notices')
add(sdk['name'], sdk['version'], 'LicenseRef-Microsoft-WebView2-SDK', sdk['url'], ecosystem='sdk')

inventory = {
    'version': json.loads((project / 'package.json').read_text())['version'],
    'target': 'x86_64-pc-windows-msvc',
    'cargo_lock_sha256': hashlib.sha256((project / 'src-tauri/Cargo.lock').read_bytes()).hexdigest(),
    'npm_lock_sha256': hashlib.sha256((project / 'package-lock.json').read_bytes()).hexdigest(),
    'packages': sorted(entries, key=lambda entry: (entry['ecosystem'], entry['name'], entry['version'])),
}
(project / 'licenses/dependencies.json').write_text(json.dumps(inventory, indent=2) + '\n', encoding='utf-8')
(project / 'THIRD_PARTY_NOTICES.txt').write_text('\n'.join(notices), encoding='utf-8')
print(f'{len(entries)} dependency entries; every entry has license/notice text. No local source paths exported.')
