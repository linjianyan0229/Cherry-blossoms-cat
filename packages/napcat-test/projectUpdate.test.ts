import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getProjectAssetName, PROJECT_GITHUB_URL, PROJECT_REPOSITORY } from '@/napcat-common/src/project-repository';
import type { ProjectRelease, ProjectReleaseAsset } from '@/napcat-common/src/project-release';
import * as projectRelease from '@/napcat-common/src/project-release';
import * as updates from '@/napcat-webui-backend/src/helper/project-update';
import { UpdateNapCatHandler, applyPendingUpdates } from '@/napcat-webui-backend/src/api/UpdateNapCat';
import { NapCatCoreWorkingEnv } from '@/napcat-webui-backend/src/types';
import type { NapCatPathWrapper } from '@/napcat-common/src/path';
import type { ILogWrapper } from '@/napcat-common/src/log-interface';

const state = vi.hoisted(() => ({
  paths: { binaryPath: '', cachePath: '', configPath: '' },
  environment: 1,
  version: '0.0.2-rc.1',
}));
vi.mock('@/napcat-webui-backend/index', () => ({ webUiPathWrapper: state.paths, webUiLogger: { logError: vi.fn() } }));
vi.mock('@/napcat-webui-backend/src/helper/Data', () => ({
  WebUiDataRuntime: {
    getWorkingEnv: () => state.environment, GetNapCatVersion: () => state.version,
  }
}));
const compressing = createRequire(new URL('../napcat-webui-backend/package.json', import.meta.url))('compressing') as {
  zip: { compressDir(source: string, destination: string, options: { ignoreBase: boolean; }): Promise<void>; };
};

function hash (data: Buffer | string): string { return createHash('sha256').update(data).digest('hex'); }
function write (base: string, relative: string, data: string): void {
  const target = path.join(base, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data);
}
function zipWithEntries (entries: Array<{ name: string; centralName?: string; mode?: number; }>, listed = entries.map((_entry, index) => index)): Buffer {
  const locals: Buffer[] = [];
  const offsets: number[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from('fixture');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    const record = Buffer.concat([header, name, data]); offsets.push(offset); locals.push(record); offset += record.length;
  }
  const central = listed.map(index => {
    const entry = entries[index]!; const name = Buffer.from(entry.centralName || entry.name);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50); header.writeUInt16LE(0x314, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(0x800, 8);
    header.writeUInt32LE(7, 20); header.writeUInt32LE(7, 24); header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(((entry.mode || 0o100644) * 65536) >>> 0, 38); header.writeUInt32LE(offsets[index]!, 42);
    return Buffer.concat([header, name]);
  });
  const centralBytes = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(listed.length, 8); end.writeUInt16LE(listed.length, 10);
  end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

function mockHttps (plans: Array<{ status?: number; location?: string; length?: string; body?: Buffer; requestError?: boolean; streamError?: boolean; }>) {
  return vi.spyOn(https, 'get').mockImplementation(((url: string | URL, _options: unknown, callback: (response: IncomingMessage) => void) => {
    const plan = plans.shift(); if (!plan) throw new Error('unexpected mock request: ' + String(url));
    const request = Object.assign(new EventEmitter(), { setTimeout: vi.fn(), destroy: vi.fn() });
    request.setTimeout.mockReturnValue(request); request.destroy.mockImplementation((error: Error) => { request.emit('error', error); return request; });
    queueMicrotask(() => {
      if (plan.requestError) { request.emit('error', new Error('fixture connection failed')); return; }
      const response = new PassThrough() as unknown as IncomingMessage;
      response.statusCode = plan.status || 200;
      response.headers = { ...(plan.location ? { location: plan.location } : {}), ...(plan.length ? { 'content-length': plan.length } : {}) };
      callback(response);
      if (plan.streamError) setImmediate(() => { response.push(Buffer.from('partial')); response.destroy(new Error('fixture stream failed')); });
      else (response as unknown as PassThrough).end(plan.body);
    });
    return request;
  }) as unknown as typeof https.get);
}
function response (): { json: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn>; } {
  const res = { json: vi.fn(), status: vi.fn() }; res.status.mockReturnValue(res); return res;
}
async function invoke (body: unknown) {
  const res = response(); await UpdateNapCatHandler({ body } as Parameters<typeof UpdateNapCatHandler>[0], res as unknown as Parameters<typeof UpdateNapCatHandler>[1], vi.fn()); return res.json.mock.calls[0]?.[0];
}

describe('本项目发行更新', () => {
  let fixture: string;
  let source: string;
  let archive: Buffer;
  let release: ProjectRelease;
  let download: typeof updates.downloadProjectAsset;

  beforeEach(async () => {
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'project-update-'));
    state.paths.binaryPath = path.join(fixture, 'install');
    state.paths.cachePath = path.join(fixture, 'cache');
    state.paths.configPath = path.join(fixture, 'config');
    for (const directory of Object.values(state.paths)) fs.mkdirSync(directory);
    state.environment = NapCatCoreWorkingEnv.Shell;
    state.version = '0.0.2-rc.1';
    vi.stubEnv('NAPCAT_IMAGE_MANAGED', '');
    vi.stubEnv('IMAGE_QQ_VERSION', '');
    source = path.join(fixture, 'source');
    write(source, 'napcat.mjs', 'export const verified = true;');
    write(source, 'config/napcat.json', '{"default":true}');
    write(source, 'config/onebot.json', '{"default":true}');
    write(source, 'plugins/personal/index.mjs', 'released plugin');
    write(source, 'plugins/personal/new.mjs', 'new released file');
    write(source, 'plugins/new-builtin/index.mjs', 'new builtin');
    write(source, 'plugins/new-builtin/package.json', '{"name":"new-builtin"}');
    write(source, 'data/account.json', 'never install account data');
    const zip = path.join(fixture, 'fixture.zip');
    await compressing.zip.compressDir(source, zip, { ignoreBase: true });
    archive = fs.readFileSync(zip);
    const names = [getProjectAssetName('Shell', state.version), getProjectAssetName('Framework', state.version)];
    const sums = `${hash(archive)}  ${names[0]}\n${hash(archive)}  ${names[1]}\n`;
    const assets: ProjectReleaseAsset[] = [...names, 'SHA256SUMS.txt'].map(name => ({
      name,
      size: name === 'SHA256SUMS.txt' ? Buffer.byteLength(sums) : archive.length,
      browser_download_url: `${PROJECT_GITHUB_URL}/releases/download/v${state.version}/${name}`,
    }));
    release = { tag_name: `v${state.version}`, version: state.version, prerelease: true, body: '', published_at: '2026-11-22T00:00:00Z', assets };
    vi.spyOn(projectRelease, 'getProjectRelease').mockResolvedValue(release);
    vi.spyOn(https, 'get').mockImplementation(() => { throw new Error('unexpected network access in fixture'); });
    download = vi.fn(async (asset, _tag, destination) => {
      const bytes = asset.name === 'SHA256SUMS.txt' ? Buffer.from(sums) : archive;
      fs.writeFileSync(destination, bytes); return hash(bytes);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks(); vi.unstubAllEnvs();
    if (path.dirname(fixture) !== path.resolve(os.tmpdir()) || !path.basename(fixture).startsWith('project-update-')) throw new Error('fixture cleanup out of scope');
    fs.rmSync(fixture, { recursive: true, force: true });
  });

  it('唯一精确匹配所选运行包校验和，拒绝重复和路径伪装', () => {
    const name = getProjectAssetName('Shell', state.version);
    expect(updates.checksumForAsset(`${hash('x')}  ${name}\n`, name)).toBe(hash('x'));
    expect(() => updates.checksumForAsset(`${hash('x')}  ${name}\n${hash('x')}  ${name}\n`, name)).toThrow('唯一');
    expect(() => updates.checksumForAsset(`${hash('x')}  ../${name}\n`, name)).toThrow('唯一');
    expect(() => updates.checksumForAsset(`invalid  ${name}\n`, name)).toThrow('格式');
  });

  it('按完整 SemVer 拒绝降级，强制标记才允许', () => {
    expect(() => updates.assertUpdateVersion('0.0.2-rc.10', '0.0.2-rc.2', false)).toThrow('低于');
    expect(() => updates.assertUpdateVersion('0.0.2-rc.10', '0.0.2-rc.2', true)).not.toThrow();
    expect(() => updates.assertUpdateVersion('0.0.2-rc.2', '0.0.2-rc.10', false)).not.toThrow();
    expect(() => updates.assertUpdateVersion('0.0.2', 'bad', true)).toThrow('无效');
  });

  it('仅允许本仓库下载起点及 GitHub HTTPS 资产 CDN', () => {
    const name = getProjectAssetName('Shell', state.version);
    expect(updates.isAllowedAssetRedirect(release.assets[0]!.browser_download_url, release.tag_name, name)).toBe(true);
    expect(updates.isAllowedAssetRedirect('https://release-assets.githubusercontent.com/asset?token=fixture', release.tag_name, name)).toBe(true);
    for (const url of ['http://release-assets.githubusercontent.com/asset', 'https://example.test/asset', 'https://github.com/other/project/releases/download/v0.0.2/x.zip', 'https://release-assets.githubusercontent.com:8443/asset']) expect(updates.isAllowedAssetRedirect(url, release.tag_name, name)).toBe(false);
  });

  it('ZIP SHA 错误时不解压、不更改安装文件并清理本次 staging', async () => {
    write(state.paths.binaryPath, 'napcat.mjs', 'old');
    const extract = vi.fn();
    const badDownload = vi.fn(async (asset: ProjectReleaseAsset, tag: string, destination: string) => {
      const value = await download(asset, tag, destination); return asset.name === 'SHA256SUMS.txt' ? value : '0'.repeat(64);
    });
    await expect(updates.stageProjectUpdate(state.paths, release, 'Shell', { download: badDownload, extract })).rejects.toThrow('校验失败');
    expect(extract).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(state.paths.binaryPath, 'napcat.mjs'), 'utf8')).toBe('old');
    expect(fs.readdirSync(path.join(state.paths.cachePath, 'project-updates'))).toEqual([]);
  });

  it('校验后替换核心，保留已有配置和整个用户插件目录，完整初始化新插件', async () => {
    write(state.paths.binaryPath, 'napcat.mjs', 'old');
    write(state.paths.binaryPath, 'config/napcat.json', 'personal napcat');
    write(state.paths.binaryPath, 'config/onebot.json', 'personal onebot');
    write(state.paths.binaryPath, 'plugins/personal/index.mjs', 'personal plugin');
    const update = await updates.stageProjectUpdate(state.paths, release, 'Shell', { download });
    expect(updates.applyVerifiedUpdate(state.paths, update)).toEqual([]);
    expect(fs.readFileSync(path.join(state.paths.binaryPath, 'napcat.mjs'), 'utf8')).toContain('verified');
    expect(fs.readFileSync(path.join(state.paths.binaryPath, 'config/napcat.json'), 'utf8')).toBe('personal napcat');
    expect(fs.readFileSync(path.join(state.paths.binaryPath, 'config/onebot.json'), 'utf8')).toBe('personal onebot');
    expect(fs.readFileSync(path.join(state.paths.binaryPath, 'plugins/personal/index.mjs'), 'utf8')).toBe('personal plugin');
    expect(fs.existsSync(path.join(state.paths.binaryPath, 'plugins/personal/new.mjs'))).toBe(false);
    expect(fs.existsSync(path.join(state.paths.binaryPath, 'plugins/new-builtin/index.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(state.paths.binaryPath, 'plugins/new-builtin/package.json'))).toBe(true);
    expect(fs.existsSync(path.join(state.paths.binaryPath, 'data/account.json'))).toBe(false);
  });

  it('Framework 仅选择对应版本的 Framework ZIP', async () => {
    const update = await updates.stageProjectUpdate(state.paths, release, 'Framework', { download });
    expect(update.runtime).toBe('Framework');
    expect(update.archiveName).toBe(getProjectAssetName('Framework', state.version));
    expect(vi.mocked(download).mock.calls[1]?.[0].name).toBe(update.archiveName);
  });

  it.each([
    ['central 路径穿越', [{ name: 'napcat.mjs', centralName: '../bad.mjs' }], [0]],
    ['local 与 central 文件名不一致', [{ name: '../bad.mjs', centralName: 'napcat.mjs' }], [0]],
    ['符号链接', [{ name: 'napcat.mjs', mode: 0o120777 }], [0]],
    ['重复 local 引用', [{ name: 'napcat.mjs' }], [0, 0]],
    ['未列出的 local 文件', [{ name: 'napcat.mjs' }, { name: '../hidden.mjs' }], [0]],
  ] as const)('解包前拒绝 %s', (_name, entries, listed) => {
    const zip = path.join(fixture, 'unsafe.zip');
    fs.writeFileSync(zip, zipWithEntries(entries.map(entry => ({ ...entry })), [...listed]));
    expect(() => updates.validateProjectZip(zip)).toThrow();
  });

  const zipAvailable = (process.env['PATH'] || '').split(path.delimiter).some(directory => {
    try { fs.accessSync(path.join(directory, 'zip'), fs.constants.X_OK); return fs.statSync(path.join(directory, 'zip')).isFile(); } catch { return false; }
  });
  it.skipIf(!zipAvailable)('接受发行 runner 的实际 zip -q -r . 布局（需要现有 zip 工具）', () => {
    const zip = path.join(fixture, 'release-runner.zip');
    execFileSync('zip', ['-q', '-r', zip, '.'], { cwd: source });
    expect(() => updates.validateProjectZip(zip)).not.toThrow();
  });

  it('真实下载 pipeline 跟随 GitHub CDN并核对字节大小和SHA', async () => {
    const asset = { ...release.assets[0]!, size: 3 };
    const get = mockHttps([{ status: 302, location: 'https://release-assets.githubusercontent.com/fixture' }, { body: Buffer.from('abc'), length: '3' }]);
    const destination = path.join(fixture, 'download.zip');
    await expect(updates.downloadProjectAsset(asset, release.tag_name, destination)).resolves.toBe(hash('abc'));
    expect(fs.readFileSync(destination, 'utf8')).toBe('abc'); expect(get).toHaveBeenCalledTimes(2);
  });

  it('跨repo起点、HTTP和外域重定向从不发往其他项目', async () => {
    const asset = { ...release.assets[0]!, size: 3 };
    const get = mockHttps([{ status: 302, location: 'https://example.test/untrusted' }]);
    await expect(updates.downloadProjectAsset({ ...asset, browser_download_url: 'https://github.com/other/project/releases/download/v0.0.2/x.zip' }, release.tag_name, path.join(fixture, 'cross.zip'))).rejects.toThrow('本项目');
    await expect(updates.downloadProjectAsset({ ...asset, browser_download_url: asset.browser_download_url.replace('https:', 'http:') }, release.tag_name, path.join(fixture, 'http.zip'))).rejects.toThrow('本项目');
    expect(get).not.toHaveBeenCalled();
    await expect(updates.downloadProjectAsset(asset, release.tag_name, path.join(fixture, 'redirect.zip'))).rejects.toThrow('范围');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('下载目标已存在时独占创建失败，不删除或覆盖已有文件', async () => {
    const asset = { ...release.assets[0]!, size: 3 };
    mockHttps([{ body: Buffer.from('abc') }]);
    const destination = path.join(fixture, 'existing.zip');
    fs.writeFileSync(destination, 'existing');
    await expect(updates.downloadProjectAsset(asset, release.tag_name, destination)).rejects.toThrow();
    expect(fs.readFileSync(destination, 'utf8')).toBe('existing');
  });

  it('下载重定向最多5跳，声明大小不符或流错误会清理新文件', async () => {
    const asset = { ...release.assets[0]!, size: 3 };
    const get = mockHttps(Array.from({ length: 6 }, () => ({ status: 302, location: 'https://release-assets.githubusercontent.com/loop' })));
    await expect(updates.downloadProjectAsset(asset, release.tag_name, path.join(fixture, 'loop.zip'))).rejects.toThrow('过多');
    expect(get).toHaveBeenCalledTimes(6); get.mockRestore();
    mockHttps([{ body: Buffer.from('ab') }, { streamError: true }, { requestError: true }]);
    for (const name of ['short.zip', 'error.zip', 'connection.zip']) {
      const destination = path.join(fixture, name);
      await expect(updates.downloadProjectAsset(asset, release.tag_name, destination)).rejects.toThrow();
      expect(fs.existsSync(destination)).toBe(false);
    }
  });

  it('原子替换失败保留旧文件，可经带校验 pending 重试', async () => {
    write(state.paths.binaryPath, 'napcat.mjs', 'old');
    const update = await updates.stageProjectUpdate(state.paths, release, 'Shell', { download });
    const original = fs.renameSync;
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (to === path.join(state.paths.binaryPath, 'napcat.mjs')) throw new Error('fixture locked');
      original(from, to);
    });
    const remaining = updates.applyVerifiedUpdate(state.paths, update);
    expect(remaining.map(file => file.relativePath)).toEqual(['napcat.mjs']);
    expect(fs.readFileSync(path.join(state.paths.binaryPath, 'napcat.mjs'), 'utf8')).toBe('old');
    rename.mockRestore();
    updates.writePendingUpdate(state.paths, { ...update, files: remaining });
    const pending = updates.validatePendingUpdate(state.paths, JSON.parse(fs.readFileSync(updates.pendingUpdatePath(state.paths), 'utf8')));
    expect(updates.applyVerifiedUpdate(state.paths, pending)).toEqual([]);
  });

  it('pending 仓库、相对路径和源文件任一篡改均在替换前拒绝', async () => {
    write(state.paths.binaryPath, 'napcat.mjs', 'old');
    const update = await updates.stageProjectUpdate(state.paths, release, 'Shell', { download });
    expect(update.repository).toBe(PROJECT_REPOSITORY);
    expect(() => updates.validatePendingUpdate(state.paths, { ...update, repository: 'other/project' })).toThrow('来源');
    expect(() => updates.validatePendingUpdate(state.paths, { ...update, files: [{ ...update.files[0], relativePath: '../escape' }] })).toThrow('路径');
    write(path.join(state.paths.cachePath, 'project-updates', update.stageName, 'extract'), 'napcat.mjs', 'tampered');
    expect(() => updates.applyVerifiedUpdate(state.paths, update)).toThrow('校验失败');
    expect(fs.readFileSync(path.join(state.paths.binaryPath, 'napcat.mjs'), 'utf8')).toBe('old');
  });

  it('旧绝对路径 pending 不应用、不删除记录、不使启动抛错', async () => {
    write(state.paths.binaryPath, 'napcat.mjs', 'old');
    const record = { version: 'upstream', files: [{ sourcePath: path.join(source, 'napcat.mjs'), targetPath: path.join(state.paths.binaryPath, 'napcat.mjs') }] };
    fs.writeFileSync(updates.pendingUpdatePath(state.paths), JSON.stringify(record));
    const logger = { log: vi.fn(), logWarn: vi.fn(), logError: vi.fn() };
    await expect(applyPendingUpdates(state.paths as NapCatPathWrapper, logger as unknown as ILogWrapper, 'Shell')).resolves.toBeUndefined();
    expect(fs.readFileSync(path.join(state.paths.binaryPath, 'napcat.mjs'), 'utf8')).toBe('old');
    expect(JSON.parse(fs.readFileSync(updates.pendingUpdatePath(state.paths), 'utf8'))).toEqual(record);
    expect(logger.logWarn).toHaveBeenCalled();
  });

  it('共享config/cache时拒绝另一安装目录的pending并保留记录', async () => {
    write(state.paths.binaryPath, 'napcat.mjs', 'first install');
    const update = await updates.stageProjectUpdate(state.paths, release, 'Shell', { download });
    updates.writePendingUpdate(state.paths, update);
    const other = { ...state.paths, binaryPath: path.join(fixture, 'other-install') };
    write(other.binaryPath, 'napcat.mjs', 'other install');
    const logger = { log: vi.fn(), logWarn: vi.fn(), logError: vi.fn() };
    await applyPendingUpdates(other as NapCatPathWrapper, logger as unknown as ILogWrapper, 'Shell');
    expect(fs.readFileSync(path.join(other.binaryPath, 'napcat.mjs'), 'utf8')).toBe('other install');
    expect(JSON.parse(fs.readFileSync(updates.pendingUpdatePath(other), 'utf8'))).toEqual(update);
    expect(logger.logWarn.mock.calls[0]?.[1]).toBeInstanceOf(Error);
  });

  it('Shell pending不能应用到Framework运行类型', async () => {
    write(state.paths.binaryPath, 'napcat.mjs', 'old');
    const update = await updates.stageProjectUpdate(state.paths, release, 'Shell', { download });
    updates.writePendingUpdate(state.paths, update);
    const logger = { log: vi.fn(), logWarn: vi.fn(), logError: vi.fn() };
    await applyPendingUpdates(state.paths as NapCatPathWrapper, logger as unknown as ILogWrapper, 'Framework');
    expect(fs.readFileSync(path.join(state.paths.binaryPath, 'napcat.mjs'), 'utf8')).toBe('old');
    expect(fs.existsSync(updates.pendingUpdatePath(state.paths))).toBe(true);
    expect(() => updates.validatePendingUpdate(state.paths, update, 'Framework')).toThrow('运行类型');
  });

  it('启动后替换pending核心如实提示再次手动重启', async () => {
    write(state.paths.binaryPath, 'napcat.mjs', 'old');
    const update = await updates.stageProjectUpdate(state.paths, release, 'Shell', { download });
    updates.writePendingUpdate(state.paths, { ...update, files: update.files.filter(file => file.relativePath === 'napcat.mjs') });
    const logger = { log: vi.fn(), logWarn: vi.fn(), logError: vi.fn() };
    await applyPendingUpdates(state.paths as NapCatPathWrapper, logger as unknown as ILogWrapper, 'Shell');
    expect(fs.readFileSync(path.join(state.paths.binaryPath, 'napcat.mjs'), 'utf8')).toContain('verified');
    expect(logger.logWarn.mock.calls[0]?.[0]).toContain('再次手动重启');
    expect(fs.existsSync(updates.pendingUpdatePath(state.paths))).toBe(false);
  });

  it('镜像管理实例在获取 release 或下载前明确拒绝文件更新', async () => {
    vi.stubEnv('NAPCAT_IMAGE_MANAGED', '1');
    const fetch = vi.spyOn(projectRelease, 'getProjectRelease');
    const result = await invoke({ targetVersion: release.tag_name });
    expect(result.code).not.toBe(0); expect(result.message).toContain('Docker'); expect(result.message).toContain(PROJECT_GITHUB_URL);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('拒绝 action 和外部镜像，不请求其他项目来源', async () => {
    const fetch = vi.spyOn(projectRelease, 'getProjectRelease');
    expect((await invoke({ targetVersion: 'action-123' })).code).not.toBe(0);
    expect((await invoke({ mirror: 'https://example.test/' })).code).not.toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('API在下载前执行降级门禁，字符串强制标记不能绕过', async () => {
    state.version = '0.0.3';
    const stage = vi.spyOn(updates, 'stageProjectUpdate');
    expect((await invoke({ targetVersion: release.tag_name })).message).toContain('低于');
    expect((await invoke({ targetVersion: release.tag_name, force: 'true' })).message).toContain('布尔');
    expect(stage).not.toHaveBeenCalled();
  });

  it('旧镜像只有 IMAGE_QQ_VERSION 时同样不执行文件更新', async () => {
    vi.stubEnv('IMAGE_QQ_VERSION', '3.2.35-54395');
    const fetch = vi.spyOn(projectRelease, 'getProjectRelease');
    expect((await invoke({})).message).toContain('Docker');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('并发请求不能共享下载 staging', async () => {
    let resolveRelease!: (value: ProjectRelease) => void;
    vi.spyOn(projectRelease, 'getProjectRelease').mockImplementation(() => new Promise((resolve) => { resolveRelease = resolve; }));
    vi.spyOn(updates, 'stageProjectUpdate').mockRejectedValue(new Error('fixture stops before download'));
    const first = invoke({});
    const second = await invoke({});
    expect(second.message).toContain('进行中');
    resolveRelease(release); await first;
  });
});
