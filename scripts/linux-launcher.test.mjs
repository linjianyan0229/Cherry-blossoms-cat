import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const launcher = path.join(root, 'packages/napcat-shell-loader/launcher-linux.sh');

test('Linux preparation preserves source/config, restores bytes and rejects changed files or concurrent use',
  { skip: process.platform !== 'linux', timeout: 30000 }, async () => {
    const scratch = fs.mkdtempSync('/tmp/cherry-launcher-test-');
    const source = path.join(scratch, 'QQ installation');
    const shell = path.join(scratch, 'Shell release');
    const work = path.join(scratch, 'work directory');
    const pkg = {
      version: '3.2.35-54395', buildVersion: '54395', platform: 'linux', eleArch: process.arch,
      main: './application.asar/app_launcher/index.js', untouched: { marker: 'preserve me' },
    };
    const original = JSON.stringify(pkg, null, 4) + '\n';
    const packageFile = path.join(source, 'resources/app/package.json');
    const write = (filename, content, mode = 0o600) => {
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename, content, { mode });
    };
    write(packageFile, original);
    write(path.join(source, 'qq'), 'not executed in prepare-only tests', 0o700);
    write(path.join(source, 'resources/app/wrapper.node'), 'original wrapper fixture');
    write(path.join(shell, 'napcat.mjs'), 'throw new Error("prepare-only must not execute this");');
    write(path.join(shell, 'config/napcat.json'), JSON.stringify({ bypass: { hook: false }, custom: 'template' }));
    write(path.join(shell, 'native/packet', `MoeHoo.linux.${process.arch}.node`), 'not loaded');
    write(path.join(shell, 'native/napi2native', `napi2native.linux.${process.arch}.node`), 'not loaded');
    const command = (...extra) => spawnSync('bash', [launcher, '--qq', source, '--shell', shell, '--workdir', work, ...extra],
      { encoding: 'utf8', timeout: 30000 });
    const succeeded = result => assert.equal(result.status, 0, result.stderr);
    const runtimePackage = path.join(work, 'linux-qq-runtime/qq/resources/app/package.json');
    let held;
    try {
      succeeded(command('--prepare-only'));
      assert.equal(fs.readFileSync(packageFile, 'utf8'), original);
      const injected = JSON.parse(fs.readFileSync(runtimePackage, 'utf8'));
      assert.equal(injected.main, './cherry-linux-bootstrap.cjs');
      delete injected.main;
      const expected = { ...pkg };
      delete expected.main;
      assert.deepEqual(injected, expected);
      const config = path.join(work, 'config/napcat.json');
      write(config, '{"custom":"user configuration"}\n');
      succeeded(command('--prepare-only'));
      assert.equal(fs.readFileSync(config, 'utf8'), '{"custom":"user configuration"}\n');
      succeeded(spawnSync('bash', [launcher, '--workdir', work, '--restore'], { encoding: 'utf8' }));
      assert.equal(fs.readFileSync(runtimePackage, 'utf8'), original);
      succeeded(command('--prepare-only'));

      held = spawn('flock', ['-x', path.join(work, '.linux-launcher.lock'), 'sh', '-c', 'printf LOCKED; cat >/dev/null'],
        { stdio: ['pipe', 'pipe', 'pipe'] });
      await once(held.stdout, 'data');
      assert.notEqual(command('--prepare-only').status, 0);
      held.stdin.end();
      await once(held, 'exit');
      held = undefined;

      write(path.join(shell, 'config/.env'), 'NAPCAT_WORKDIR=/unexpected\n');
      assert.notEqual(command('--prepare-only').status, 0);
      fs.unlinkSync(path.join(shell, 'config/.env'));
      write(path.join(source, 'resources/app/wrapper.node'), 'changed wrapper, same package metadata');
      assert.notEqual(command('--prepare-only').status, 0);
      write(path.join(source, 'resources/app/wrapper.node'), 'original wrapper fixture');
      write(runtimePackage, JSON.stringify({ ...pkg, main: './another-tool.cjs' }));
      const changed = fs.readFileSync(runtimePackage, 'utf8');
      assert.notEqual(command('--prepare-only').status, 0);
      assert.notEqual(spawnSync('bash', [launcher, '--workdir', work, '--restore'], { encoding: 'utf8' }).status, 0);
      assert.equal(fs.readFileSync(runtimePackage, 'utf8'), changed);
      assert.equal(fs.readFileSync(packageFile, 'utf8'), original);
    } finally {
      if (held) { held.stdin.end(); held.kill(); }
      assert.equal(path.dirname(scratch), '/tmp');
      assert.ok(path.basename(scratch).startsWith('cherry-launcher-test-'));
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
