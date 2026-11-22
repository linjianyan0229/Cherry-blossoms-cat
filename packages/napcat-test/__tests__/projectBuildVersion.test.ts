import fs from 'node:fs';
import https from 'node:https';
import { afterEach, describe, expect, it, vi } from 'vitest';
import vitePluginNapcatVersion, { resolveBuildVersion, validateVersion } from '../../napcat-vite/vite-plugin-version.js';
import repository from '../../napcat-common/src/project-repository.json';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('本项目构建版本来源', () => {
  it('发行环境版本优先于源码版本，保留有效预发布与构建元数据', () => {
    expect(resolveBuildVersion({ envVersion: 'v0.0.2-rc.1+review', sourceVersion: '0.0.1' })).toBe('0.0.2-rc.1+review');
    expect(validateVersion('0.0.2-rc.1').valid).toBe(true);
  });

  it('显式非法发行版本直接失败，不会悄悄改用源码或其他仓库版本', () => {
    expect(() => resolveBuildVersion({ envVersion: '0.0.2-01', sourceVersion: '0.0.1' })).toThrow('NAPCAT_VERSION');
    expect(() => resolveBuildVersion({ envVersion: '', sourceVersion: '0.0.1' })).toThrow('NAPCAT_VERSION');
  });

  it('无环境版本时使用源码版本；源码版本不可用时给出明确 dev 标记', () => {
    expect(resolveBuildVersion({ sourceVersion: 'v0.0.1' })).toBe('0.0.1');
    expect(resolveBuildVersion({ sourceVersion: 'not-a-version' })).toBe('0.0.0-dev');
  });

  it('构建插件只读共享仓库与源码版本，不读取旧 tag 缓存、不写文件或发网络请求', () => {
    vi.stubEnv('NAPCAT_VERSION', undefined);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const read = vi.spyOn(fs, 'readFileSync').mockImplementation((file) => {
      const name = String(file);
      if (name.endsWith('project-repository.json')) return JSON.stringify(repository);
      if (name.endsWith('/package.json')) return JSON.stringify({ version: '0.0.1' });
      throw new Error(`不应读取缓存或其他文件：${name}`);
    });
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    const mkdir = vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
    const get = vi.spyOn(https, 'get').mockImplementation(() => { throw new Error('构建版本不得联网'); });
    const result = vitePluginNapcatVersion().config({ define: { keep: 'existing' } });
    expect(result.define).toEqual({ keep: 'existing', 'import.meta.env.VITE_NAPCAT_VERSION': '"0.0.1"' });
    expect(read).toHaveBeenCalledTimes(2);
    expect(write).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
});
