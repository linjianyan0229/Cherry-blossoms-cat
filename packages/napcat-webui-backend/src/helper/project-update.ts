import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { createHash, randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { IncomingMessage } from 'node:http';
import compressing from 'compressing';
import { getProjectAssetName, PROJECT_NAME, PROJECT_REPOSITORY, type ProjectRuntime } from 'napcat-common/src/project-repository';
import { isProjectReleaseAssetUrl, type ProjectRelease, type ProjectReleaseAsset } from 'napcat-common/src/project-release';
import { compareSemVer, parseSemVer } from 'napcat-common/src/version';

export interface UpdatePaths { binaryPath: string; cachePath: string; configPath: string; }
export interface VerifiedUpdateFile { relativePath: string; sha256: string; mode: number; }
export interface ProjectPendingUpdate {
  format: 2;
  repository: string;
  version: string;
  tag: string;
  runtime: ProjectRuntime;
  installationRoot: string;
  stageName: string;
  archiveName: string;
  archiveSha256: string;
  preservedPluginNames: string[];
  files: VerifiedUpdateFile[];
}
export interface StageDependencies {
  download?: typeof downloadProjectAsset;
  extract?: (archive: string, destination: string) => Promise<void>;
}

const SHA256 = /^[0-9a-f]{64}$/;
const MAX_ZIP_BYTES = 1024 * 1024 * 1024;
const MAX_EXTRACT_BYTES = 2 * 1024 * 1024 * 1024;
const CDN_HOSTS = new Set([
  'release-assets.githubusercontent.com', 'objects.githubusercontent.com',
  'github-releases.githubusercontent.com', 'github-production-release-asset-2e65be.s3.amazonaws.com',
]);
const SKIP_FILES = new Set(['NapCatWinBootMain.exe', 'NapCatWinBootHook.dll', 'quickLoginExample.bat']);

export function assertUpdateVersion (current: string, target: string, force: boolean): void {
  if (!parseSemVer(target).valid) throw new Error('目标项目版本号无效');
  if (!parseSemVer(current).valid && !force) throw new Error('当前版本号无效，请明确选择强制更新');
  if (parseSemVer(current).valid && compareSemVer(target, current) < 0 && !force) throw new Error('目标版本低于当前版本，请明确选择强制更新后再试');
}

export function checksumForAsset (text: string, assetName: string): string {
  const matches: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
    if (!match) throw new Error('SHA256SUMS.txt 格式无效');
    if (match[2] === assetName) matches.push(match[1]!);
  }
  if (matches.length !== 1) throw new Error('SHA256SUMS.txt 必须包含所选发行包的唯一精确记录');
  return matches[0]!;
}

export function isAllowedAssetRedirect (url: string, tag: string, assetName: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443') || parsed.hash) return false;
    return parsed.hostname === 'github.com' ? isProjectReleaseAssetUrl(url, tag, assetName) : CDN_HOSTS.has(parsed.hostname);
  } catch { return false; }
}

async function assetResponse (url: string, tag: string, assetName: string, remaining = 5): Promise<IncomingMessage> {
  if (!isAllowedAssetRedirect(url, tag, assetName)) throw new Error('发行资产重定向超出本项目 GitHub 下载范围');
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': `${PROJECT_NAME}-WebUI`, Accept: 'application/octet-stream' } }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
        response.resume();
        if (!response.headers.location || remaining === 0) { reject(new Error('发行资产重定向过多或缺少地址')); return; }
        let next: string;
        try { next = new URL(response.headers.location, url).href; } catch { reject(new Error('发行资产重定向地址无效')); return; }
        assetResponse(next, tag, assetName, remaining - 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`项目发行包下载失败：HTTP ${response.statusCode}`)); return; }
      resolve(response);
    });
    request.setTimeout(30_000, () => request.destroy(new Error('项目发行包下载超时')));
    request.once('error', reject);
  });
}

export async function downloadProjectAsset (asset: ProjectReleaseAsset, tag: string, destination: string): Promise<string> {
  if (!isProjectReleaseAssetUrl(asset.browser_download_url, tag, asset.name)) throw new Error('发行资产不属于本项目 GitHub');
  const limit = asset.name === 'SHA256SUMS.txt' ? 64 * 1024 : MAX_ZIP_BYTES;
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > limit) throw new Error('发行资产大小超出支持范围');
  const response = await assetResponse(asset.browser_download_url, tag, asset.name);
  const length = response.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) !== asset.size)) { response.destroy(); throw new Error('发行资产响应长度与 GitHub 记录不一致'); }
  const hash = createHash('sha256');
  let received = 0;
  const verify = new Transform({ transform (chunk: Buffer, _encoding, callback) {
    received += chunk.length;
    if (received > asset.size) { callback(new Error('发行资产超过声明大小')); return; }
    hash.update(chunk); callback(null, chunk);
  } });
  const writer = fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 });
  let created = false;
  writer.once('open', () => { created = true; });
  try {
    await pipeline(response, verify, writer);
    if (received !== asset.size) throw new Error('发行资产下载不完整');
    return hash.digest('hex');
  } catch (error) {
    if (created && fs.existsSync(destination) && fs.lstatSync(destination).isFile()) fs.unlinkSync(destination);
    throw error;
  }
}

export function safeRelativePath (relative: string): string {
  if (!relative || relative.length > 4096 || relative.includes('\\') || /[\0\r\n:]/.test(relative) || relative.startsWith('/')) throw new Error('更新文件相对路径无效');
  const pieces = relative.replace(/\/$/, '').split('/');
  if (pieces.some(part => !part || part === '.' || part === '..')) throw new Error('更新文件路径越界');
  return pieces.join('/');
}

/** Reject unsafe directory entries before the ZIP library writes extracted files. */
export function validateProjectZip (archive: string): void {
  const fd = fs.openSync(archive, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    if (size < 22 || size > MAX_ZIP_BYTES) throw new Error('发行 ZIP 大小无效');
    const tail = Buffer.alloc(Math.min(size, 65_557));
    fs.readSync(fd, tail, 0, tail.length, size - tail.length);
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) { end = i; break; }
    }
    if (end < 0 || tail.readUInt16LE(end + 4) !== 0 || tail.readUInt16LE(end + 6) !== 0) throw new Error('不支持此 ZIP 布局');
    const count = tail.readUInt16LE(end + 10);
    const directorySize = tail.readUInt32LE(end + 12);
    const offset = tail.readUInt32LE(end + 16);
    if (!count || count === 0xffff || tail.readUInt16LE(end + 8) !== count || directorySize > 16 * 1024 * 1024 || offset + directorySize > size - tail.length + end) throw new Error('不支持 ZIP64 或多卷发行包');
    const directory = Buffer.alloc(directorySize);
    if (fs.readSync(fd, directory, 0, directorySize, offset) !== directorySize) throw new Error('ZIP 目录不完整');
    const names = new Set<string>();
    const localRanges: Array<{ start: number; end: number; }> = [];
    let cursor = 0;
    let extractedBytes = 0;
    for (let index = 0; index < count; index++) {
      if (cursor + 46 > directory.length || directory.readUInt32LE(cursor) !== 0x02014b50) throw new Error('ZIP 目录项无效');
      const nameLength = directory.readUInt16LE(cursor + 28);
      const next = cursor + 46 + nameLength + directory.readUInt16LE(cursor + 30) + directory.readUInt16LE(cursor + 32);
      if (next > directory.length) throw new Error('ZIP 文件名不完整');
      const nameBytes = directory.subarray(cursor + 46, cursor + 46 + nameLength);
      const rawName = nameBytes.toString('utf8');
      if (!Buffer.from(rawName, 'utf8').equals(nameBytes)) throw new Error('ZIP 文件名编码无效');
      const name = safeRelativePath(rawName);
      const key = process.platform === 'win32' ? name.toLowerCase() : name;
      if (names.has(key)) throw new Error('ZIP 包含重复路径');
      names.add(key);
      const mode = directory.readUInt32LE(cursor + 38) >>> 16;
      if ((mode & 0xf000) === 0xa000 || (directory.readUInt16LE(cursor + 8) & 1) !== 0) throw new Error('发行 ZIP 不允许链接或加密文件');
      const method = directory.readUInt16LE(cursor + 10);
      if (method !== 0 && method !== 8) throw new Error('发行 ZIP 压缩方法不受支持');
      const localOffset = directory.readUInt32LE(cursor + 42);
      const local = Buffer.alloc(30);
      if (localOffset + 30 > offset || fs.readSync(fd, local, 0, 30, localOffset) !== 30 || local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(26) !== nameLength || local.readUInt16LE(8) !== method || local.readUInt16LE(6) !== directory.readUInt16LE(cursor + 8)) throw new Error('ZIP 本地文件头与目录不一致');
      const localName = Buffer.alloc(nameLength);
      if (fs.readSync(fd, localName, 0, nameLength, localOffset + 30) !== nameLength || !localName.equals(nameBytes)) throw new Error('ZIP 本地文件名与目录不一致');
      let localEnd = localOffset + 30 + nameLength + local.readUInt16LE(28) + directory.readUInt32LE(cursor + 20);
      if ((local.readUInt16LE(6) & 8) !== 0) {
        const descriptor = Buffer.alloc(4);
        if (fs.readSync(fd, descriptor, 0, 4, localEnd) !== 4) throw new Error('ZIP 数据描述不完整');
        localEnd += descriptor.readUInt32LE(0) === 0x08074b50 ? 16 : 12;
      }
      if (localEnd > offset) throw new Error('ZIP 文件数据越界');
      localRanges.push({ start: localOffset, end: localEnd });
      extractedBytes += directory.readUInt32LE(cursor + 24);
      if (extractedBytes > MAX_EXTRACT_BYTES) throw new Error('发行 ZIP 解压内容过大');
      cursor = next;
    }
    if (cursor !== directory.length) throw new Error('ZIP 目录大小不一致');
    localRanges.sort((a, b) => a.start - b.start);
    let localCursor = 0;
    for (const range of localRanges) { if (range.start !== localCursor) throw new Error('ZIP 包含目录外文件或重叠数据'); localCursor = range.end; }
    if (localCursor !== offset) throw new Error('ZIP 本地文件列表不完整');
  } finally { fs.closeSync(fd); }
}

function digestFile (file: string): string {
  const hash = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(64 * 1024);
  try { let count: number; while ((count = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, count)); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

function checkedDirectory (directory: string): void {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('更新目录包含非预期链接');
  if (process.getuid && stat.uid !== process.getuid()) throw new Error('更新临时目录必须属于当前用户');
}

function stagingRoot (paths: UpdatePaths): string {
  checkedDirectory(path.resolve(paths.cachePath));
  const root = path.join(fs.realpathSync(paths.cachePath), 'project-updates');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  checkedDirectory(root);
  return fs.realpathSync(root);
}

function stageDirectory (paths: UpdatePaths, name: string): string {
  if (!/^update-[0-9a-f-]{36}$/.test(name)) throw new Error('更新临时目录标识无效');
  const directory = path.join(stagingRoot(paths), name);
  checkedDirectory(directory);
  return directory;
}

export function removeUpdateStage (paths: UpdatePaths, stageName: string): void {
  const directory = stageDirectory(paths, stageName);
  if (path.dirname(directory) !== stagingRoot(paths)) throw new Error('拒绝清理范围外的更新目录');
  fs.rmSync(directory, { recursive: true, force: false });
}

function scanVerifiedFiles (directory: string, root = directory): VerifiedUpdateFile[] {
  const files: VerifiedUpdateFile[] = [];
  for (const name of fs.readdirSync(directory)) {
    const full = path.join(directory, name);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error('解压内容不允许符号链接');
    if (stat.isDirectory()) files.push(...scanVerifiedFiles(full, root));
    else if (stat.isFile()) files.push({ relativePath: safeRelativePath(path.relative(root, full).split(path.sep).join('/')), sha256: digestFile(full), mode: stat.mode & 0o777 });
    else throw new Error('解压内容包含非常规文件');
  }
  return files;
}

export async function stageProjectUpdate (paths: UpdatePaths, release: ProjectRelease, runtime: ProjectRuntime, dependencies: StageDependencies = {}): Promise<ProjectPendingUpdate> {
  const archiveName = getProjectAssetName(runtime, release.version);
  const asset = release.assets.find(item => item.name === archiveName);
  const checksums = release.assets.find(item => item.name === 'SHA256SUMS.txt');
  if (!asset || !checksums) throw new Error('本项目发行缺少对应运行包或 SHA256SUMS.txt');
  const stageName = `update-${randomUUID()}`;
  const directory = path.join(stagingRoot(paths), stageName);
  fs.mkdirSync(directory, { mode: 0o700 });
  try {
    const download = dependencies.download || downloadProjectAsset;
    const sumsPath = path.join(directory, 'SHA256SUMS.txt');
    await download(checksums, release.tag_name, sumsPath);
    const checksum = checksumForAsset(fs.readFileSync(sumsPath, 'utf8'), archiveName);
    const archive = path.join(directory, 'archive.zip');
    const downloadedHash = await download(asset, release.tag_name, archive);
    if (downloadedHash !== checksum || digestFile(archive) !== checksum || fs.statSync(archive).size !== asset.size) throw new Error('项目发行 ZIP 的 SHA-256 或大小校验失败');
    validateProjectZip(archive);
    const extract = path.join(directory, 'extract');
    fs.mkdirSync(extract, { mode: 0o700 });
    if (dependencies.extract) await dependencies.extract(archive, extract);
    else await compressing.zip.uncompress(archive, extract);
    const files = scanVerifiedFiles(extract);
    if (!files.some(file => file.relativePath === 'napcat.mjs')) throw new Error('项目发行包缺少核心入口');
    const pluginNames = [...new Set(files.filter(file => file.relativePath.startsWith('plugins/')).map(file => file.relativePath.split('/')[1]!))];
    const preservedPluginNames = pluginNames.filter(name => fs.existsSync(path.join(paths.binaryPath, 'plugins', name)));
    const installationRoot = fs.realpathSync(path.resolve(paths.binaryPath));
    return { format: 2, repository: PROJECT_REPOSITORY, version: release.version, tag: release.tag_name, runtime, installationRoot, stageName, archiveName, archiveSha256: checksum, preservedPluginNames, files };
  } catch (error) { removeUpdateStage(paths, stageName); throw error; }
}

function assertNoLinksBetween (root: string, target: string): void {
  const relative = path.relative(root, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('更新目标越界');
  let current = root;
  for (const piece of relative.split(path.sep)) {
    current = path.join(current, piece);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('更新路径包含符号链接'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}

export function validatePendingUpdate (paths: UpdatePaths, raw: unknown, expectedRuntime?: ProjectRuntime): ProjectPendingUpdate {
  const update = raw as ProjectPendingUpdate;
  if (!update || update.format !== 2 || update.repository !== PROJECT_REPOSITORY || !['Shell', 'Framework'].includes(update.runtime) || !parseSemVer(update.version).valid || update.archiveName !== getProjectAssetName(update.runtime, update.version) || !SHA256.test(update.archiveSha256) || !Array.isArray(update.files) || !update.files.length || !Array.isArray(update.preservedPluginNames) || update.preservedPluginNames.some(name => typeof name !== 'string' || safeRelativePath(name) !== name || name.includes('/'))) throw new Error('旧格式或来源不明的待更新记录不允许应用');
  if (typeof update.installationRoot !== 'string' || update.installationRoot !== fs.realpathSync(path.resolve(paths.binaryPath))) throw new Error('待更新记录不属于当前安装目录');
  if (expectedRuntime && update.runtime !== expectedRuntime) throw new Error('待更新记录与当前 Shell/Framework 运行类型不一致');
  if (!parseSemVer(update.tag).valid || parseSemVer(update.tag).normalized !== parseSemVer(update.version).normalized) throw new Error('待更新记录版本不一致');
  const directory = stageDirectory(paths, update.stageName);
  const archive = path.join(directory, 'archive.zip');
  const archiveStat = fs.lstatSync(archive);
  if (!archiveStat.isFile() || archiveStat.isSymbolicLink() || digestFile(archive) !== update.archiveSha256) throw new Error('待更新 ZIP 身份校验失败');
  const sumsPath = path.join(directory, 'SHA256SUMS.txt');
  const sumsStat = fs.lstatSync(sumsPath);
  if (!sumsStat.isFile() || sumsStat.isSymbolicLink() || sumsStat.size > 64 * 1024) throw new Error('待更新校验清单无效');
  const expected = checksumForAsset(fs.readFileSync(sumsPath, 'utf8'), update.archiveName);
  if (expected !== update.archiveSha256) throw new Error('待更新校验清单不一致');
  checkedDirectory(path.join(directory, 'extract'));
  const seen = new Set<string>();
  for (const file of update.files) {
    if (!file || typeof file.relativePath !== 'string' || safeRelativePath(file.relativePath) !== file.relativePath || !SHA256.test(file.sha256) || !Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777 || seen.has(file.relativePath)) throw new Error('待更新文件清单无效');
    seen.add(file.relativePath);
    const source = path.join(directory, 'extract', ...file.relativePath.split('/'));
    assertNoLinksBetween(path.join(directory, 'extract'), source);
    const stat = fs.lstatSync(source);
    if (!stat.isFile() || stat.isSymbolicLink() || digestFile(source) !== file.sha256) throw new Error('待更新文件内容校验失败');
  }
  return update;
}

function preserveFile (root: string, relative: string, preservedPlugins: string[]): boolean {
  const pieces = relative.split('/');
  const top = pieces[0]!.toLowerCase();
  if (SKIP_FILES.has(pieces.at(-1)!) || pieces.some(part => part.toLowerCase() === '.env') || ['data', 'qq-data', 'qq', 'profile', 'logs', 'cache'].includes(top)) return true;
  if (top === 'config') return fs.existsSync(path.join(root, ...pieces));
  if (top === 'plugins' && pieces.length > 1) return preservedPlugins.includes(pieces[1]!) || fs.existsSync(path.join(root, ...pieces));
  return false;
}

export function applyVerifiedUpdate (paths: UpdatePaths, update: ProjectPendingUpdate, onFailure?: (file: string, error: unknown) => void, expectedRuntime?: ProjectRuntime): VerifiedUpdateFile[] {
  validatePendingUpdate(paths, update, expectedRuntime);
  const root = fs.realpathSync(path.resolve(paths.binaryPath));
  const directory = stageDirectory(paths, update.stageName);
  const remaining: VerifiedUpdateFile[] = [];
  for (const file of update.files) {
    if (preserveFile(root, file.relativePath, update.preservedPluginNames)) continue;
    const target = path.join(root, ...file.relativePath.split('/'));
    const source = path.join(directory, 'extract', ...file.relativePath.split('/'));
    let temporary: string | undefined;
    try {
      assertNoLinksBetween(root, target);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      assertNoLinksBetween(root, target);
      if (fs.existsSync(target) && !fs.lstatSync(target).isFile()) throw new Error('更新目标不是普通文件');
      temporary = path.join(path.dirname(target), `.cherry-update-${randomUUID()}`);
      fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(temporary, file.mode);
      if (digestFile(temporary) !== file.sha256) throw new Error('替换副本内容校验失败');
      fs.renameSync(temporary, target);
      temporary = undefined;
    } catch (error) { remaining.push(file); onFailure?.(file.relativePath, error); }
    finally { if (temporary && fs.existsSync(temporary) && fs.lstatSync(temporary).isFile()) fs.unlinkSync(temporary); }
  }
  return remaining;
}

export function pendingUpdatePath (paths: UpdatePaths): string { return path.join(paths.configPath, 'napcat-update.json'); }

export function writePendingUpdate (paths: UpdatePaths, update: ProjectPendingUpdate): void {
  const destination = pendingUpdatePath(paths);
  const temporary = path.join(paths.configPath, `.cherry-pending-${randomUUID()}`);
  try { fs.writeFileSync(temporary, JSON.stringify(update, null, 2), { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, destination); }
  finally { if (fs.existsSync(temporary) && fs.lstatSync(temporary).isFile()) fs.unlinkSync(temporary); }
}
