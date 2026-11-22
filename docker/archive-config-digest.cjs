'use strict';

// Read Docker save metadata only. No image is loaded and no application starts.
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const path = require('node:path');

try {
  if (process.argv.length !== 3) throw new Error('用法：node archive-config-digest.cjs 镜像.tar.gz');
  const archive = path.resolve(process.argv[2]);
  const readMember = (member, maxBuffer) => execFileSync('tar', [
    '--extract', '--gzip', '--to-stdout', '--file', archive, '--', member,
  ], { maxBuffer, stdio: ['ignore', 'pipe', 'pipe'] });
  const manifest = JSON.parse(readMember('manifest.json', 1024 * 1024).toString('utf8'));
  if (!Array.isArray(manifest) || manifest.length !== 1) throw new Error('离线归档必须只包含一个镜像配置记录。');
  const configPath = manifest[0]?.Config;
  if (typeof configPath !== 'string' || !/^(?:[0-9a-f]{64}\.json|blobs\/sha256\/[0-9a-f]{64})$/.test(configPath)) {
    throw new Error('归档 Config 路径必须为 hash.json 或 blobs/sha256/hash，且只含 64 位小写十六进制摘要。');
  }
  const expected = configPath.endsWith('.json') ? configPath.slice(0, -5) : configPath.slice('blobs/sha256/'.length);
  const config = readMember(configPath, 8 * 1024 * 1024);
  const digest = createHash('sha256').update(config).digest('hex');
  if (digest !== expected) throw new Error('Config 文件内容 SHA-256 与归档路径摘要不一致。');
  const info = JSON.parse(config.toString('utf8'));
  if (!info || typeof info !== 'object' || Array.isArray(info)) throw new Error('镜像 Config 必须为 JSON 对象。');
  process.stdout.write(`sha256:${digest}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
