import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fullVersionPattern = /^(\d+\.\d+\.\d+)-([1-9]\d*)$/;
const versionPattern = /^\d+\.\d+\.\d+$/;

export function readPackageVersion (info) {
  const match = typeof info?.version === 'string' && info.version.match(fullVersionPattern);
  if (!match) throw new Error('QQ package.json 缺少完整 version（版本号-Build）');
  if (info.buildVersion !== undefined && String(info.buildVersion) !== match[2]) {
    throw new Error('QQ package.json 的 version 与 buildVersion 不一致');
  }
  return { fullVersion: match[0], version: match[1], build: match[2] };
}

export function readOfficialLinux (metadata, source) {
  const linux = metadata?.Linux;
  if (!linux || !versionPattern.test(linux.version ?? '')) throw new Error('官方配置缺少合法 Linux.version');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(linux.updateDate ?? '') ||
    !Number.isFinite(Date.parse(linux.updateDate)) || new Date(linux.updateDate).toISOString().slice(0, 10) !== linux.updateDate) {
    throw new Error('官方配置缺少合法 Linux.updateDate');
  }
  const downloads = {};
  for (const [arch, key] of [['x64', 'x64DownloadUrl'], ['arm64', 'armDownloadUrl']]) {
    const value = linux[key]?.deb;
    let url;
    try { url = new URL(value); } catch { throw new Error(`官方配置缺少 ${arch} DEB 下载地址`); }
    if (url.protocol !== 'https:' || !['qqdl.gtimg.cn', 'dldir1.qq.com', 'dldir2.qq.com'].includes(url.hostname)) {
      throw new Error(`官方配置中的 ${arch} 下载地址需要人工核对`);
    }
    downloads[arch] = url.href;
  }
  return { source, version: linux.version, updateDate: linux.updateDate, downloads };
}

export function compareVersions (left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function selectLatest (sources) {
  if (sources.length === 0) throw new Error('没有可读取的官方 Linux QQ 配置');
  const sorted = [...sources].sort((a, b) => compareVersions(b.version, a.version) || b.updateDate.localeCompare(a.updateDate));
  const latest = sorted[0];
  const sourcesDisagree = sources.some(item => item.version !== latest.version || item.updateDate !== latest.updateDate);
  const newestDate = [...sources].sort((a, b) => b.updateDate.localeCompare(a.updateDate))[0];
  return { latest, sourcesDisagree, versionAndDateConflict: newestDate.version !== latest.version };
}

export function lookupMappings (version, arch, tables) {
  const key = `${version}-${arch}`;
  const appid = tables.appid[key] ?? (arch === 'x64' ? tables.appid[version] : undefined);
  const hexValid = value => typeof value === 'string' && /^[0-9a-f]+$/i.test(value) && !/^0+$/.test(value);
  const offsetValid = data => hexValid(data?.send) && hexValid(data?.recv);
  const expectedQua = `V1_LNX_NQ_${version.replace('-', '_')}_GW_B`;
  return {
    appid: Boolean(appid && /^[1-9]\d*$/.test(String(appid.appid)) && appid.qua === expectedQua),
    packet: offsetValid(tables.packet[key]),
    napi2native: offsetValid(tables.napi2native[key]),
  };
}

export function validateManifest (manifest, tables) {
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.clients) || manifest.clients.length === 0) {
    throw new Error('Linux QQ 维护清单格式无效');
  }
  const seen = new Set();
  return manifest.clients.map(client => {
    if (!fullVersionPattern.test(client.version) || !['x64', 'arm64'].includes(client.arch)) {
      throw new Error('维护清单必须包含完整 QQ 版本和受支持的 Linux 架构');
    }
    const key = `${client.version}-${client.arch}`;
    if (seen.has(key)) throw new Error(`维护清单重复版本：${key}`);
    seen.add(key);
    const mappings = lookupMappings(client.version, client.arch, tables);
    if (client.requireMappings && !Object.values(mappings).every(Boolean)) {
      throw new Error(`维护清单与 AppID/原生偏移表不一致：${key}`);
    }
    if (!['login-verified', 'startup-verified', 'mapping-only', 'metadata-only'].includes(client.validation)) {
      throw new Error(`维护清单验证级别无效：${key}`);
    }
    if (client.package?.sha256 !== null && !/^[a-f0-9]{64}$/.test(client.package?.sha256 ?? '')) {
      throw new Error(`QQ 包 SHA256 无效：${key}`);
    }
    return { version: client.version, arch: client.arch, validation: client.validation, mappings };
  });
}

async function readJson (filename) {
  return JSON.parse(await fs.readFile(filename, 'utf8'));
}

export function assessPackageValidation (installed, arch, clients, tables, latest, debSha256) {
  const client = installed && clients.find(item => item.arch === arch && item.version === installed.fullVersion);
  const installedBuildVerified = Boolean(client && client.validation === 'login-verified' &&
    Object.values(lookupMappings(installed.fullVersion, arch, tables)).every(Boolean));
  const packageIdentityVerified = Boolean(client && installed.version === latest.version &&
    (client.package.officialUrl ?? client.package.url) === latest.downloads[arch] &&
    client.package.updateDate === latest.updateDate && debSha256 && debSha256 === client.package.sha256);
  return { installedBuildVerified, packageIdentityVerified,
    currentOfficialPackageValidated: installedBuildVerified && packageIdentityVerified,
    fullBuildRequiresPackageInspection: !packageIdentityVerified };
}

async function hashFile (filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

async function main () {
  const args = process.argv.slice(2);
  const metadataFiles = [];
  let checkOnly = false;
  let packagePath;
  let debPath;
  let arch = process.arch;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--check') checkOnly = true;
    else if (['--metadata', '--qq-package', '--qq-deb', '--arch'].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} 缺少参数`);
      if (arg === '--metadata') metadataFiles.push(value);
      else if (arg === '--qq-package') packagePath = value;
      else if (arg === '--qq-deb') debPath = value;
      else arch = value;
    } else throw new Error(`未知参数：${arg}`);
  }
  if (!['x64', 'arm64'].includes(arch)) throw new Error('请使用 --arch x64 或 --arch arm64');
  if (checkOnly && (packagePath || debPath || metadataFiles.length)) throw new Error('--check 只校验维护清单，不能与安装包或官方配置参数组合');
  if (debPath && !packagePath) throw new Error('--qq-deb 需要同时提供 --qq-package');
  const [manifest, appid, packet, napi2native] = await Promise.all([
    readJson(path.join(root, 'compatibility/linux-qq.json')),
    readJson(path.join(root, 'packages/napcat-core/external/appid.json')),
    readJson(path.join(root, 'packages/napcat-core/external/packet.json')),
    readJson(path.join(root, 'packages/napcat-core/external/napi2native.json')),
  ]);
  const tables = { appid, packet, napi2native };
  const clients = validateManifest(manifest, tables);
  const installed = packagePath ? readPackageVersion(await readJson(packagePath)) : undefined;
  const debSha256 = debPath ? await hashFile(debPath) : undefined;
  const report = { clients, installed: installed && { ...installed, arch, mappings: lookupMappings(installed.fullVersion, arch, tables) } };
  if (checkOnly) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const requests = metadataFiles.length
    ? metadataFiles.map(async file => readOfficialLinux(await readJson(file), file))
    : manifest.officialSources.map(async source => {
      const response = await fetch(source, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return readOfficialLinux(await response.json(), source);
    });
  const outcomes = await Promise.allSettled(requests);
  const sources = outcomes.filter(item => item.status === 'fulfilled').map(item => item.value);
  const errors = outcomes.flatMap((item, index) => item.status === 'rejected' ? [{
    source: metadataFiles[index] ?? manifest.officialSources[index], error: item.reason.message,
  }] : []);
  const selected = selectLatest(sources);
  const reportedVersionHasValidatedBuild = clients.some(client => client.arch === arch && client.version.split('-')[0] === selected.latest.version &&
    client.validation === 'login-verified' && Object.values(client.mappings).every(Boolean));
  const validation = assessPackageValidation(installed, arch, manifest.clients, tables, selected.latest, debSha256);
  console.log(JSON.stringify({ ...report, sources, errors, ...selected, reportedVersionHasValidatedBuild, ...validation }, null, 2));
  if (!validation.currentOfficialPackageValidated || selected.versionAndDateConflict || errors.length) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Linux QQ 维护检查失败：${error.message}`);
    process.exitCode = 1;
  });
}
