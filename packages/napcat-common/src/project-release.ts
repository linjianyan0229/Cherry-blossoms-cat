import https from 'node:https';
import { compareSemVer, parseSemVer } from './version';
import { getProjectAssetName, PROJECT_API_URL, PROJECT_NAME, PROJECT_OWNER } from './project-repository';

export interface ProjectReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

export interface ProjectRelease {
  tag_name: string;
  version: string;
  prerelease: boolean;
  body: string;
  published_at: string;
  assets: ProjectReleaseAsset[];
}

export type ProjectReleaseRequest = (url: string) => Promise<unknown>;

function record (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A release asset must originate from this exact project's public HTTPS path. */
export function isProjectReleaseAssetUrl (value: string, tag: string, assetName: string): boolean {
  try {
    const url = new URL(value);
    if (url.origin !== 'https://github.com' || !url.href.startsWith(`${url.origin}/`) || url.search || url.hash) return false;
    const parts = url.pathname.split('/').map(part => decodeURIComponent(part));
    const expected = ['', PROJECT_OWNER, PROJECT_NAME, 'releases', 'download', tag, assetName];
    return parts.length === expected.length && parts.every((part, index) => part === expected[index]);
  } catch {
    return false;
  }
}

/** Reject drafts, unpublished versions, incomplete packages and foreign assets. */
export function normalizeProjectRelease (raw: unknown): ProjectRelease | null {
  if (!record(raw) || raw['draft'] !== false || typeof raw['tag_name'] !== 'string') return null;
  const parsed = parseSemVer(raw['tag_name']);
  if (!parsed.valid || typeof raw['prerelease'] !== 'boolean' || !Array.isArray(raw['assets'])) return null;
  const publishedAt = raw['published_at'];
  if (typeof publishedAt !== 'string' || !Number.isFinite(Date.parse(publishedAt))) return null;

  const assets: ProjectReleaseAsset[] = [];
  const names = new Set<string>();
  for (const asset of raw['assets']) {
    if (!record(asset) || typeof asset['name'] !== 'string' || typeof asset['browser_download_url'] !== 'string') return null;
    const name = asset['name'];
    const size = asset['size'];
    const hasControlCharacter = [...name].some(character => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f);
    if (!name || /[\\/]/.test(name) || hasControlCharacter || names.has(name) ||
        typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 ||
        !isProjectReleaseAssetUrl(asset['browser_download_url'], raw['tag_name'], name)) return null;
    names.add(name);
    assets.push({ name, size, browser_download_url: asset['browser_download_url'] });
  }

  const required = [getProjectAssetName('Shell', parsed.normalized), getProjectAssetName('Framework', parsed.normalized), 'SHA256SUMS.txt'];
  if (!required.every(name => names.has(name))) return null;
  return {
    tag_name: raw['tag_name'],
    version: parsed.normalized,
    prerelease: raw['prerelease'],
    body: typeof raw['body'] === 'string' ? raw['body'] : '',
    published_at: publishedAt,
    assets,
  };
}

export function filterProjectReleases (raw: unknown): ProjectRelease[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeProjectRelease)
    .filter((release): release is ProjectRelease => release !== null)
    .sort((a, b) => compareSemVer(b.version, a.version) || Date.parse(b.published_at) - Date.parse(a.published_at));
}

function ownReleaseApiUrl (value: string): boolean {
  try {
    const url = new URL(value);
    const base = new URL(PROJECT_API_URL);
    return url.origin === base.origin && url.href.startsWith(`${url.origin}/`) && !url.hash &&
      url.pathname === `${base.pathname}/releases` &&
      [...url.searchParams.keys()].every(key => key === 'page' || key === 'per_page') &&
      /^\d+$/.test(url.searchParams.get('page') ?? '') && url.searchParams.get('per_page') === '100';
  } catch {
    return false;
  }
}

/** Public GitHub metadata only; no mirror, credential or redirect fallback. */
export const requestProjectReleaseJson: ProjectReleaseRequest = async (url) => {
  if (!ownReleaseApiUrl(url)) throw new Error('项目发行元数据地址不属于本仓库');
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `${PROJECT_NAME}-release-check`, 'X-GitHub-Api-Version': '2022-11-28' },
    }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`本仓库发行查询失败：HTTP ${response.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024) {
          response.destroy(new Error('项目发行元数据过大'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('项目发行元数据不是有效 JSON')); }
      });
    });
    request.setTimeout(10000, () => request.destroy(new Error('本仓库发行查询超时')));
    request.on('error', reject);
  });
};

function copyReleases (releases: ProjectRelease[]): ProjectRelease[] {
  return releases.map(release => ({ ...release, assets: release.assets.map(asset => ({ ...asset })) }));
}

/** Injectable metadata transport lets tests exercise selection without network writes. */
export function createProjectReleaseService (
  request: ProjectReleaseRequest = requestProjectReleaseJson,
  options: { cacheTtlMs?: number, now?: () => number; } = {}
) {
  const cacheTtlMs = options.cacheTtlMs ?? 5 * 60 * 1000;
  const now = options.now ?? Date.now;
  let cache: { releases: ProjectRelease[], time: number; } | undefined;
  let pending: Promise<ProjectRelease[]> | undefined;

  async function loadReleases (): Promise<ProjectRelease[]> {
    const raw: unknown[] = [];
    for (let page = 1; page <= 20; page++) {
      const url = `${PROJECT_API_URL}/releases?per_page=100&page=${page}`;
      if (!ownReleaseApiUrl(url)) throw new Error('项目发行元数据地址不属于本仓库');
      const result = await request(url);
      if (!Array.isArray(result)) throw new Error('本仓库发行列表格式无效');
      raw.push(...result);
      if (result.length < 100) return filterProjectReleases(raw);
    }
    throw new Error('本仓库发行列表超过可完整查询的分页范围');
  }

  async function getProjectReleases (): Promise<ProjectRelease[]> {
    if (cache && now() - cache.time < cacheTtlMs) return copyReleases(cache.releases);
    if (!pending) {
      pending = loadReleases().then(releases => {
        cache = { releases, time: now() };
        return releases;
      }).finally(() => { pending = undefined; });
    }
    return copyReleases(await pending);
  }

  async function getProjectRelease (targetTag = 'latest'): Promise<ProjectRelease> {
    const parsed = targetTag === 'latest' ? undefined : parseSemVer(targetTag);
    if (parsed && !parsed.valid) throw new Error('仅支持本仓库已发布的语义版本，不支持 Actions 临时更新');
    const releases = await getProjectReleases();
    const release = targetTag === 'latest'
      ? releases[0]
      : releases.find(item => item.tag_name === targetTag) ?? releases.find(item => item.version === parsed?.normalized);
    if (!release) throw new Error('本仓库没有对应的完整已发布发行包');
    return release;
  }

  return { getProjectReleases, getProjectRelease };
}

const service = createProjectReleaseService();
export const getProjectReleases = service.getProjectReleases;
export const getProjectRelease = service.getProjectRelease;
