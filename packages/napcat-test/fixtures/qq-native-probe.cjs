'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Run the same native assertions with QQ's custom Electron/Node exports.
// Only the executable and application entry are copied. Public resources stay read-only.
const qqExecutable = fs.realpathSync(process.argv[2]);
const probeSource = process.argv[3];
if (process.platform !== 'linux' || !probeSource) {
  throw new Error('QQ runtime probe requires Linux, a QQ executable, and probe source.');
}
const input = fs.readFileSync(0);
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'napcat-native-probe-'));

function linkContents (source, destination, excluded) {
  fs.mkdirSync(destination, { recursive: true });
  for (const name of fs.readdirSync(source)) {
    if (!excluded.includes(name)) fs.symlinkSync(path.join(source, name), path.join(destination, name));
  }
}

try {
  const original = path.dirname(qqExecutable);
  const runtime = path.join(fixture, 'QQ');
  const executableName = path.basename(qqExecutable);
  linkContents(original, runtime, [executableName, 'resources']);
  fs.copyFileSync(qqExecutable, path.join(runtime, executableName), fs.constants.COPYFILE_FICLONE);
  fs.chmodSync(path.join(runtime, executableName), 0o700);
  linkContents(path.join(original, 'resources'), path.join(runtime, 'resources'), ['app']);
  const originalApp = path.join(original, 'resources', 'app');
  const app = path.join(runtime, 'resources', 'app');
  linkContents(originalApp, app, ['package.json', 'napcat-native-probe.cjs']);
  const manifest = JSON.parse(fs.readFileSync(path.join(originalApp, 'package.json'), 'utf8'));
  manifest.main = './napcat-native-probe.cjs';
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(app, 'napcat-native-probe.cjs'), probeSource);

  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  for (const key of ['HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_RUNTIME_DIR']) {
    environment[key] = path.join(fixture, key.toLowerCase());
    fs.mkdirSync(environment[key], { mode: 0o700 });
  }
  const result = spawnSync('xvfb-run', [
    '-a', path.join(runtime, executableName), '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  ], {
    cwd: runtime,
    env: environment,
    input,
    timeout: 20000,
    encoding: 'utf8',
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`QQ native probe terminated with ${result.signal}`);
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
