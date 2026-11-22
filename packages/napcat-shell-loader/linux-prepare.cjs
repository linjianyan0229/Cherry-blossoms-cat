'use strict';

// System Node prepares files only. QQ's own Electron process runs the Shell.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const TOOL = 'Cherry-blossoms-cat-linux-shell';
const MAIN = './cherry-linux-bootstrap.cjs';
const STUB = 'cherry-linux-bootstrap.cjs';

function fail (message) { throw new Error(message); }
function options (argv) {
  const result = {};
  const allowed = new Set(['--qq', '--shell', '--workdir', '--qq-data-dir']);
  for (let i = 0; i < argv.length; i += 2) {
    if (!allowed.has(argv[i]) || !argv[i + 1]) fail('文件准备参数无效');
    if (result[argv[i]]) fail('文件准备参数重复');
    result[argv[i]] = argv[i + 1];
  }
  return result;
}
function inputPath (value) {
  if (typeof value !== 'string' || !value || /[\r\n\0]/.test(value)) fail('目录参数无效');
  return path.resolve(value);
}
function present (file) {
  try { fs.lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function futurePath (value) {
  let current = inputPath(value);
  const missing = [];
  while (!present(current)) {
    missing.unshift(path.basename(current));
    const parent = path.dirname(current);
    if (parent === current) fail('无法解析目录');
    current = parent;
  }
  return path.join(fs.realpathSync(current), ...missing);
}
function overlaps (a, b) {
  const inside = (parent, child) => child === parent || child.startsWith(parent + path.sep);
  return inside(a, b) || inside(b, a);
}
function regular (file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`需要普通文件：${file}`);
}
function directory (dir) {
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(dir) !== dir) fail(`目录包含非预期链接：${dir}`);
  return stat;
}
function ownedDirectory (dir) {
  const stat = directory(dir);
  if (stat.uid !== process.getuid()) fail(`专用目录必须属于当前用户：${dir}`);
}
function safeDirectory (dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  ownedDirectory(dir);
}
function digest (bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function fileDigest (file) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.alloc(64 * 1024);
  const fd = fs.openSync(file, 'r');
  try {
    let size;
    while ((size = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, size));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
function atomicWrite (file, bytes) {
  const temporary = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
  fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
  try { fs.renameSync(temporary, file); } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function metadata (raw) {
  const info = JSON.parse(raw.toString('utf8'));
  if (!info || typeof info !== 'object' || Array.isArray(info)) fail('QQ package.json 无效');
  const version = info.version;
  const match = typeof version === 'string' && version.match(/^\d+\.\d+\.\d+[-.](\d+)$/);
  if (!match) fail('QQ package.json 必须包含带 Build 的完整 version');
  const build = String(info.buildVersion ?? match[1]);
  if (!/^\d+$/.test(build) || build !== match[1]) fail('QQ version 与 buildVersion 不一致');
  if (info.platform && info.platform !== 'linux') fail('QQ 安装树不是 Linux 客户端');
  if (info.eleArch && info.eleArch !== process.arch) fail('QQ 安装树架构与系统 Node 架构不一致');
  if (typeof info.main !== 'string' || !info.main) fail('QQ package.json 缺少原始 main');
  return { info, version, build };
}
function plan (opts, restore = false) {
  const work = futurePath(opts['--workdir']);
  if (work === path.parse(work).root) fail('工作目录不能是文件系统根目录');
  const runtime = path.join(work, 'linux-qq-runtime');
  if (restore) {
    if (!present(runtime)) fail('该工作目录没有本启动器的 QQ 运行副本，拒绝恢复');
    ownedDirectory(runtime);
    const stateFile = path.join(runtime, 'launcher-state.json');
    regular(stateFile);
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (state.tool !== TOOL || state.format !== 1) fail('该运行目录不是本启动器创建的副本');
    return { work, runtime };
  }
  const source = fs.realpathSync(inputPath(opts['--qq']));
  const shell = fs.realpathSync(inputPath(opts['--shell']));
  const data = futurePath(opts['--qq-data-dir'] || path.join(work, 'qq-data'));
  if (overlaps(work, source) || overlaps(work, shell)) fail('请使用与 QQ 安装目录和 Shell 发行目录分开的专用工作目录');
  if (data === path.parse(data).root || overlaps(data, source) || overlaps(data, shell) || overlaps(data, runtime)) fail('QQ 数据目录与安装、发行或运行副本目录重叠');
  if (fs.existsSync(path.join(shell, 'config', '.env'))) fail('发行目录 config/.env 会覆盖启动参数，请先移走该文件；不会读取或打印其内容');
  if (present(path.join(source, 'resources/app.asar'))) fail('QQ 存在优先的 app.asar 入口，当前启动器仅支持 resources/app 布局');
  for (const dir of [source, path.join(source, 'resources'), path.join(source, 'resources/app'), shell]) directory(dir);
  for (const file of [path.join(source, 'qq'), path.join(source, 'resources/app/package.json'), path.join(source, 'resources/app/wrapper.node'), path.join(shell, 'napcat.mjs'), path.join(shell, 'config/napcat.json'), path.join(__dirname, 'linux-bootstrap.cjs')]) regular(file);
  fs.accessSync(path.join(source, 'qq'), fs.constants.X_OK);
  for (const kind of ['napi2native', 'packet']) {
    const name = kind === 'packet' ? 'MoeHoo' : 'napi2native';
    regular(path.join(shell, 'native', kind, `${name}.linux.${process.arch}.node`));
  }
  const raw = fs.readFileSync(path.join(source, 'resources/app/package.json'));
  const meta = metadata(raw);
  return { work, runtime, source, shell, data, raw, meta };
}
function prepareRoot (p) {
  safeDirectory(p.work);
  const lock = path.join(p.work, '.linux-launcher.lock');
  if (present(lock)) {
    regular(lock);
    if (fs.statSync(lock).uid !== process.getuid()) fail('目录锁文件必须属于当前用户');
  }
}
function managed (p) {
  ownedDirectory(p.runtime);
  for (const dir of ['qq', 'qq/resources', 'qq/resources/app']) ownedDirectory(path.join(p.runtime, dir));
  const stateFile = path.join(p.runtime, 'launcher-state.json');
  const backupFile = path.join(p.runtime, 'original-package.json');
  const packageFile = path.join(p.runtime, 'qq/resources/app/package.json');
  for (const file of [stateFile, backupFile, packageFile, path.join(p.runtime, 'qq/resources/app', STUB)]) regular(file);
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  if (state.tool !== TOOL || state.format !== 1) fail('该运行目录不是本启动器创建的副本');
  const backup = fs.readFileSync(backupFile);
  if (digest(backup) !== state.packageHash) fail('原始 package.json 备份校验失败');
  const current = fs.readFileSync(packageFile);
  const currentHash = digest(current);
  if (currentHash !== state.packageHash && currentHash !== state.injectedHash) fail('运行副本 package.json 已被其他操作修改，拒绝覆盖');
  if (fileDigest(path.join(p.runtime, 'qq/resources/app', STUB)) !== state.stubHash) fail('运行副本引导文件已被其他操作修改');
  regular(path.join(p.runtime, 'qq/qq'));
  if (fileDigest(path.join(p.runtime, 'qq/qq')) !== state.executableHash) fail('运行副本 QQ 可执行文件已被修改');
  const wrapper = path.join(p.runtime, 'qq/resources/app/wrapper.node');
  regular(wrapper);
  if (fileDigest(wrapper) !== state.wrapperHash) fail('运行副本 wrapper.node 已被修改');
  return { state, backup, current, currentHash, packageFile, stateFile };
}
function installEntry (p, target, state) {
  const stub = `// ${TOOL}\nrequire(${JSON.stringify(path.join(__dirname, 'linux-bootstrap.cjs'))});\n`;
  const injected = Buffer.from(JSON.stringify({ ...p.meta.info, main: MAIN }, null, 2) + '\n');
  state.stubHash = digest(Buffer.from(stub));
  state.injectedHash = digest(injected);
  state.shell = p.shell;
  atomicWrite(path.join(target, 'qq/resources/app', STUB), stub);
  atomicWrite(path.join(target, 'qq/resources/app/package.json'), injected);
  atomicWrite(path.join(target, 'qq-version.json'), JSON.stringify({
    baseVersion: p.meta.version, curVersion: p.meta.version, prevVersion: '', onErrorVersions: [], buildId: p.meta.build,
  }, null, 2) + '\n');
  atomicWrite(path.join(target, 'launcher-state.json'), JSON.stringify(state, null, 2) + '\n');
}
function prepare (p) {
  prepareRoot(p);
  const sourceHash = fileDigest(path.join(p.source, 'qq'));
  const wrapperHash = fileDigest(path.join(p.source, 'resources/app/wrapper.node'));
  if (present(p.runtime)) {
    const existing = managed(p);
    if (existing.state.source !== p.source || existing.state.packageHash !== digest(p.raw) || existing.state.executableHash !== sourceHash || existing.state.wrapperHash !== wrapperHash) fail('QQ 安装树已变化或与已有副本不同；请为新版本选择新的 --workdir');
    installEntry(p, p.runtime, existing.state);
  } else {
    const staging = fs.mkdtempSync(path.join(p.work, '.linux-qq-prepare-'));
    try {
      fs.cpSync(p.source, path.join(staging, 'qq'), { recursive: true, preserveTimestamps: true, verbatimSymlinks: true, errorOnExist: true, force: false });
      for (const dir of ['qq', 'qq/resources', 'qq/resources/app']) {
        const target = path.join(staging, dir);
        ownedDirectory(target);
        fs.chmodSync(target, (fs.statSync(target).mode & 0o7777) | 0o700);
      }
      if (digest(fs.readFileSync(path.join(staging, 'qq/resources/app/package.json'))) !== digest(p.raw) ||
        fileDigest(path.join(staging, 'qq/qq')) !== sourceHash ||
        fileDigest(path.join(staging, 'qq/resources/app/wrapper.node')) !== wrapperHash ||
        digest(fs.readFileSync(path.join(p.source, 'resources/app/package.json'))) !== digest(p.raw) ||
        fileDigest(path.join(p.source, 'qq')) !== sourceHash ||
        fileDigest(path.join(p.source, 'resources/app/wrapper.node')) !== wrapperHash) fail('QQ 安装树在复制期间发生变化，请重试');
      if (present(path.join(staging, 'qq/resources/app', STUB))) fail('QQ 安装树已有同名启动器引导文件，拒绝覆盖');
      atomicWrite(path.join(staging, 'original-package.json'), p.raw);
      installEntry(p, staging, { tool: TOOL, format: 1, source: p.source, packageHash: digest(p.raw), executableHash: sourceHash, wrapperHash });
      fs.renameSync(staging, p.runtime);
    } catch (error) {
      // The only recursive removal is this freshly-created child of our workdir.
      if (path.dirname(staging) !== p.work || !path.basename(staging).startsWith('.linux-qq-prepare-')) fail('临时目录范围校验失败');
      ownedDirectory(staging);
      fs.rmSync(staging, { recursive: true, force: true });
      throw error;
    }
  }
  safeDirectory(p.data);
  const configDir = path.join(p.work, 'config');
  safeDirectory(configDir);
  const config = path.join(configDir, 'napcat.json');
  if (present(config)) regular(config);
  else {
    const template = path.join(p.shell, 'config/napcat.json');
    regular(template);
    fs.copyFileSync(template, config, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(config, 0o600);
  }
  console.error(`已准备 QQ ${p.meta.version}，Build ${p.meta.build}，${process.arch}；核心将由 QQ 定制 Electron 运行。`);
  if (process.arch !== 'x64' || p.meta.version !== '3.2.34-53644') console.error('该 QQ 版本或架构尚未在本项目完成真实启动验证，请按 LINUX.md 检查兼容性。');
  process.stdout.write(p.data + '\n');
}
function restore (p) {
  prepareRoot(p);
  const entry = managed(p);
  if (entry.currentHash === entry.state.packageHash) {
    console.error('专用副本入口已经恢复，无需操作。');
    return;
  }
  if (JSON.parse(entry.current.toString('utf8')).main !== MAIN) fail('当前 main 不属于本启动器，拒绝恢复');
  atomicWrite(entry.packageFile, entry.backup);
  console.error('已按原始字节恢复专用 QQ 副本的 package.json；未修改原 QQ 安装目录或 QQ 数据。');
}

try {
  if (process.platform !== 'linux' || Number(process.versions.node.split('.')[0]) < 20) fail('文件准备需要 Linux 和系统 Node.js 20 或更新版本');
  if (!['x64', 'arm64'].includes(process.arch)) fail('当前仅有 Linux x64 与 arm64 原生组件');
  const command = process.argv[2];
  const opts = options(process.argv.slice(3));
  if (command === 'root') {
    const p = plan(opts, !opts['--qq']);
    prepareRoot(p);
    process.stdout.write(p.work + '\n');
  } else if (command === 'prepare') prepare(plan(opts));
  else if (command === 'restore') restore(plan(opts, true));
  else fail('文件准备操作无效');
} catch (error) {
  console.error(`Linux 启动器：${error.message}`);
  process.exitCode = 1;
}
