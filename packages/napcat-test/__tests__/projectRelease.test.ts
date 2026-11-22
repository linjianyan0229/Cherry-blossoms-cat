import { describe, expect, it, vi } from 'vitest';
import {
  createProjectReleaseService,
  filterProjectReleases,
  isProjectReleaseAssetUrl,
  normalizeProjectRelease,
  requestProjectReleaseJson,
} from '@/napcat-common/src/project-release';
import { getProjectAssetName, PROJECT_API_URL, PROJECT_GITHUB_URL } from '@/napcat-common/src/project-repository';

function fixture (tag = 'v0.0.2-rc.1') {
  const version = tag.replace(/^v/, '');
  return {
    tag_name: tag,
    draft: false,
    prerelease: true,
    body: '本项目内测说明',
    published_at: '2026-11-22T01:00:00Z' as string | null,
    assets: [getProjectAssetName('Shell', version), getProjectAssetName('Framework', version), 'SHA256SUMS.txt'].map(name => ({
      name,
      size: 123,
      browser_download_url: `${PROJECT_GITHUB_URL}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`,
    })),
  };
}

describe('本仓库真实发行筛选', () => {
  it('保留内测状态、规范版本与真实资产，并正确比较数字预发布字段', () => {
    const result = filterProjectReleases([fixture('v0.0.2-rc.2'), fixture('v0.0.1'), fixture('v0.0.2-rc.10')]);
    expect(result.map(release => release.version)).toEqual(['0.0.2-rc.10', '0.0.2-rc.2', '0.0.1']);
    expect(result[0]).toMatchObject({ tag_name: 'v0.0.2-rc.10', prerelease: true, body: '本项目内测说明' });
    expect(result[0]?.assets).toHaveLength(3);
  });

  it('拒绝草稿、未发布版本、非法版本和缺少完整运行包的发行', () => {
    const draft = { ...fixture(), draft: true };
    const unpublished = { ...fixture(), published_at: null };
    const incomplete = fixture();
    incomplete.assets.pop();
    const invalid = { ...fixture(), tag_name: 'action-123' };
    expect(filterProjectReleases([draft, unpublished, incomplete, invalid])).toEqual([]);
  });

  it('拒绝外部资产、重复文件名与无效大小', () => {
    const foreign = fixture();
    foreign.assets[0]!.browser_download_url = 'https://github.com/another/project/releases/download/v0.0.2-rc.1/foreign.zip';
    const duplicate = fixture();
    duplicate.assets.push({ ...duplicate.assets[0]! });
    const empty = fixture();
    empty.assets[0]!.size = 0;
    expect([foreign, duplicate, empty].map(normalizeProjectRelease)).toEqual([null, null, null]);
  });

  it.each(['http://github.com', 'https://github.com.evil.example', 'https://api.github.com', 'https://release-assets.githubusercontent.com'])('资产起点拒绝非本仓库 GitHub HTTPS origin：%s', (origin) => {
    const release = fixture();
    const asset = release.assets[0]!;
    expect(isProjectReleaseAssetUrl(asset.browser_download_url.replace('https://github.com', origin), release.tag_name, asset.name)).toBe(false);
  });

  it('拒绝有 query/hash 的资产起点和与实际 tag 不符的路径', () => {
    const release = fixture();
    const asset = release.assets[0]!;
    expect(isProjectReleaseAssetUrl(asset.browser_download_url, release.tag_name, asset.name)).toBe(true);
    expect(isProjectReleaseAssetUrl(`${asset.browser_download_url}?mirror=other`, release.tag_name, asset.name)).toBe(false);
    expect(isProjectReleaseAssetUrl(`${asset.browser_download_url}#other`, release.tag_name, asset.name)).toBe(false);
    expect(isProjectReleaseAssetUrl(asset.browser_download_url, 'v0.0.1', asset.name)).toBe(false);
  });
});

describe('本仓库发行服务的隔离请求', () => {
  it('保留历史 v0.0.1 的真实 prerelease 标记，latest 选当前 rc.1 且资产名不带 tag 的 v', async () => {
    const service = createProjectReleaseService(vi.fn().mockResolvedValue([fixture('v0.0.1'), fixture('v0.0.2-rc.1')]));
    const historical = await service.getProjectRelease('v0.0.1');
    expect(historical).toMatchObject({ tag_name: 'v0.0.1', version: '0.0.1', prerelease: true });
    const latest = await service.getProjectRelease();
    expect(latest.version).toBe('0.0.2-rc.1');
    expect(latest.assets.map(asset => asset.name)).toContain(getProjectAssetName('Shell', '0.0.2-rc.1'));
    expect(latest.assets[0]!.browser_download_url).toContain('/download/v0.0.2-rc.1/');
  });

  it('默认 HTTP 元数据入口在联网前拒绝其他仓库、HTTP 与镜像参数', async () => {
    await expect(requestProjectReleaseJson(`${PROJECT_API_URL}-other/releases?per_page=100&page=1`)).rejects.toThrow('不属于本仓库');
    await expect(requestProjectReleaseJson(`${PROJECT_API_URL.replace('https:', 'http:')}/releases?per_page=100&page=1`)).rejects.toThrow('不属于本仓库');
    await expect(requestProjectReleaseJson(`${PROJECT_API_URL}/releases?per_page=100&page=1&mirror=other`)).rejects.toThrow('不属于本仓库');
  });

  it('分页只查询 own API，latest 选择真实完整 prerelease', async () => {
    const request = vi.fn().mockResolvedValueOnce(Array.from({ length: 100 }, () => ({ ...fixture('v0.0.1'), draft: true })))
      .mockResolvedValueOnce([fixture('v0.0.2-rc.1')]);
    const service = createProjectReleaseService(request);
    expect((await service.getProjectRelease()).version).toBe('0.0.2-rc.1');
    expect(request.mock.calls.map(call => call[0])).toEqual([
      `${PROJECT_API_URL}/releases?per_page=100&page=1`,
      `${PROJECT_API_URL}/releases?per_page=100&page=2`,
    ]);
    expect((await service.getProjectRelease('0.0.2-rc.1')).tag_name).toBe('v0.0.2-rc.1');
  });

  it('非法或 Actions 目标在发起网络请求前失败', async () => {
    const request = vi.fn();
    const service = createProjectReleaseService(request);
    await expect(service.getProjectRelease('action-123')).rejects.toThrow('仅支持');
    await expect(service.getProjectRelease('../../other')).rejects.toThrow('仅支持');
    expect(request).not.toHaveBeenCalled();
  });

  it('没有完整 Release、非数组响应与查询失败都不会虚构下载包或退回上游', async () => {
    const empty = createProjectReleaseService(vi.fn().mockResolvedValue([]));
    await expect(empty.getProjectRelease()).rejects.toThrow('完整已发布');
    const malformed = createProjectReleaseService(vi.fn().mockResolvedValue({ message: 'invalid' }));
    await expect(malformed.getProjectReleases()).rejects.toThrow('格式无效');
    const request = vi.fn().mockRejectedValue(new Error('HTTP 403'));
    await expect(createProjectReleaseService(request).getProjectReleases()).rejects.toThrow('HTTP 403');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('合并同时查询，且调用者无法改写缓存中的可信资产', async () => {
    const request = vi.fn().mockResolvedValue([fixture()]);
    const service = createProjectReleaseService(request);
    const [first, second] = await Promise.all([service.getProjectReleases(), service.getProjectReleases()]);
    first[0]!.assets[0]!.browser_download_url = 'https://untrusted.example/changed.zip';
    expect(second[0]!.assets[0]!.browser_download_url).toContain(PROJECT_GITHUB_URL);
    expect((await service.getProjectReleases())[0]!.assets[0]!.browser_download_url).toContain(PROJECT_GITHUB_URL);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
