/** Build with reproducible diagnostic paths instead of embedding developer home paths. */
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const project = fileURLToPath(new URL('../', import.meta.url));

export function rustBuildEnvironment(environment = process.env) {
  if (environment.RUSTFLAGS?.trim() && !environment.CARGO_ENCODED_RUSTFLAGS) {
    throw new Error('Use CARGO_ENCODED_RUSTFLAGS for custom Rust flags so paths containing spaces remain intact.');
  }
  const custom = environment.CARGO_ENCODED_RUSTFLAGS?.split('\x1f').filter(Boolean) ?? [];
  const mappings = [
    [homedir(), '/home/developer'],
    [project.replace(/[\\/]$/, ''), '/src/dootty'],
    [environment.CARGO_HOME || path.join(homedir(), '.cargo'), '/rust/cargo'],
    [environment.RUSTUP_HOME || path.join(homedir(), '.rustup'), '/rust/toolchains'],
  ];
  return {
    ...environment,
    CARGO_PROFILE_RELEASE_DEBUG: '0',
    CARGO_PROFILE_RELEASE_STRIP: 'symbols',
    CARGO_ENCODED_RUSTFLAGS: [
      '-Ctarget-feature=+crt-static', ...custom,
      ...mappings.map(([source, target]) => `--remap-path-prefix=${source}=${target}`),
    ].join('\x1f'),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const cli = path.join(project, 'node_modules/@tauri-apps/cli/tauri.js');
  const result = spawnSync(process.execPath, [cli, 'build', '--no-bundle', '--features', 'custom-protocol', '--', '--locked'], {
    cwd: project, stdio: 'inherit', env: rustBuildEnvironment(),
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
