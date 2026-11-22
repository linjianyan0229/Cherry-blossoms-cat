import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QQBasicInfoWrapper } from '@/napcat-core/helper/qq-basic-info';
import type { QQPackageInfoType } from 'napcat-common/src/types';

vi.mock('@/napcat-core/index', () => ({ getMajorPath: vi.fn() }));
vi.mock('napcat-common/src/system', async (importOriginal) => {
  const actual = await importOriginal<typeof import('napcat-common/src/system')>();
  return { ...actual, get systemPlatform () { return process.platform; } };
});

function basicInfoFixture (): QQBasicInfoWrapper {
  const info: QQBasicInfoWrapper = Object.create(QQBasicInfoWrapper.prototype);
  info.isQuickUpdate = false;
  info.QQVersionConfig = {
    baseVersion: '3.2.12.28060',
    curVersion: '3.2.12.28060',
    prevVersion: '',
    onErrorVersions: [],
    buildId: '27254',
  };
  info.QQPackageInfo = {
    version: '3.2.34-53644',
    buildVersion: '53644',
    platform: 'linux',
    eleArch: 'x64',
  };
  info.context = { logger: { log: vi.fn() } } as unknown as QQBasicInfoWrapper['context'];
  return info;
}

describe('QQ AppID lookup', () => {
  let info: QQBasicInfoWrapper;
  const archDescriptor = Object.getOwnPropertyDescriptor(process, 'arch')!;
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;

  beforeEach(() => {
    Object.defineProperty(process, 'arch', { ...archDescriptor, value: 'x64' });
    Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'linux' });
    info = basicInfoFixture();
    vi.spyOn(info, 'getFullQQVersion');
    vi.spyOn(info, 'getAppidV2ByMajor').mockReturnValue('537999999');
  });

  afterEach(() => {
    Object.defineProperty(process, 'arch', archDescriptor);
    Object.defineProperty(process, 'platform', platformDescriptor);
    vi.restoreAllMocks();
  });

  it.each([
    ['3.2.30-50969', 'x64', 537376344],
    ['3.2.30-50969', 'arm64', 537376345],
    ['3.2.32-52194', 'x64', 537379447],
    ['3.2.32-52194', 'arm64', 537379448],
    ['3.2.33-52892', 'x64', 537382855],
    ['3.2.33-52892', 'arm64', 537382856],
    ['3.2.34-53644', 'x64', 537391664],
    ['3.2.34-53644', 'arm64', 537391665],
    ['3.2.35-54395', 'x64', 537403759],
  ] as const)('uses the scanned AppID for Linux %s %s', (version, arch, appid) => {
    Object.defineProperty(process, 'arch', { ...archDescriptor, value: arch });
    vi.mocked(info.getFullQQVersion).mockReturnValue(version);

    expect(info.getAppidV2()).toEqual({
      appid,
      qua: `V1_LNX_NQ_${version.replace('-', '_')}_GW_B`,
    });
    expect(info.getAppidV2ByMajor).not.toHaveBeenCalled();
  });

  it.each([
    ['9.9.33-52230', 537379411],
    ['9.9.35-52892', 537382819],
  ] as const)('finds Windows %s by its actual package version', (version, appid) => {
    vi.mocked(info.getFullQQVersion).mockReturnValue(version);

    expect(info.getAppidV2()).toEqual({
      appid,
      qua: `V1_WIN_NQ_${version.replace('-', '_')}_GW_B`,
    });
    expect(info.getAppidV2ByMajor).not.toHaveBeenCalled();
  });

  it('preserves version-only entries when an architecture override is absent', () => {
    Object.defineProperty(process, 'arch', { ...archDescriptor, value: 'arm64' });
    vi.mocked(info.getFullQQVersion).mockReturnValue('3.2.29-49738');

    expect(info.getAppidV2()).toEqual({
      appid: 537355867,
      qua: 'V1_LNX_NQ_3.2.29_49738_GW_B',
    });
    expect(info.getAppidV2ByMajor).not.toHaveBeenCalled();
  });

  it('does not apply the new Linux x64 AppID to an unscanned arm64 package', () => {
    Object.defineProperty(process, 'arch', { ...archDescriptor, value: 'arm64' });
    info.QQPackageInfo!.version = '3.2.35-54395';
    info.QQPackageInfo!.buildVersion = '54395';

    expect(info.getAppidV2()).toEqual({ appid: '537999999', qua: 'V1_LNX_NQ_3.2.35_54395_GW_B' });
    expect(info.getAppidV2ByMajor).toHaveBeenCalledWith('3.2.35-54395');
  });

  it.each(['3.2.99-99999', '3.2.99'])('uses a normalized Linux QUA after scanning unknown version %s', (version) => {
    info.QQPackageInfo!.version = version;
    info.QQPackageInfo!.buildVersion = '99999';

    expect(info.getAppidV2()).toEqual({ appid: '537999999', qua: 'V1_LNX_NQ_3.2.99_99999_GW_B' });
    expect(info.getAppidV2ByMajor).toHaveBeenCalledWith(version);
  });

  it('uses the same normalized Linux QUA when the major scan fails', () => {
    info.QQPackageInfo!.version = '3.2.99-99999';
    info.QQPackageInfo!.buildVersion = '99999';
    vi.mocked(info.getAppidV2ByMajor).mockImplementation(() => { throw new Error('major unavailable'); });

    expect(info.getAppidV2()).toEqual({ appid: '537246140', qua: 'V1_LNX_NQ_3.2.99_99999_GW_B' });
  });

  it.each([
    ['win32', '9.9.99-99999', 'V1_WIN_9.9.99-99999_99999_GW_B'],
    ['darwin', '7.0.99-99999', 'V1_MAC_7.0.99-99999_99999_GW_B'],
  ] as const)('preserves the existing fallback format on %s', (platform, version, qua) => {
    Object.defineProperty(process, 'platform', { ...platformDescriptor, value: platform });
    info.QQPackageInfo!.version = version;
    info.QQPackageInfo!.buildVersion = '99999';

    expect(info.getQUAFallback()).toBe(qua);
  });
});

describe('QQ build selection', () => {
  let info: QQBasicInfoWrapper;

  beforeEach(() => {
    info = basicInfoFixture();
  });

  it('uses the installed Linux package build with the default version template', () => {
    expect(info.getFullQQVersion()).toBe('3.2.34-53644');
    expect(info.getQQBuildStr()).toBe('53644');
    expect(info.requireMinNTQQBuild('40768')).toBe(true);
    expect(info.requireMinNTQQBuild('41679')).toBe(true);
    expect(info.requireMinNTQQBuild('53645')).toBe(false);
  });

  it('ignores inactive quick-update metadata when selecting the package build', () => {
    info.QQVersionConfig!.curVersion = '3.2.33-52892';
    expect(info.getQQBuildStr()).toBe('53644');
  });

  it('uses the active quick-update version instead of the older installed package', () => {
    info.isQuickUpdate = true;
    info.QQVersionConfig!.curVersion = '3.2.99-99999';
    info.QQVersionConfig!.buildId = '99998';

    expect(info.getFullQQVersion()).toBe('3.2.99-99999');
    expect(info.getQQBuildStr()).toBe('99999');
    expect(info.requireMinNTQQBuild('99999')).toBe(true);
    expect(info.requireMinNTQQBuild('100000')).toBe(false);
  });

  it('uses the active quick-update buildId for legacy dotted versions', () => {
    info.isQuickUpdate = true;
    info.QQVersionConfig!.curVersion = '3.2.99.99999';
    info.QQVersionConfig!.buildId = '99999';
    expect(info.getQQBuildStr()).toBe('99999');
  });

  it('extracts the package build from its full version when buildVersion is absent', () => {
    delete (info.QQPackageInfo as Partial<QQPackageInfoType>).buildVersion;
    expect(info.getQQBuildStr()).toBe('53644');
    expect(info.requireMinNTQQBuild('53644')).toBe(true);
  });

  it.each(['', 'broken', '53644bad', '0', '-1', '53644.5', ' 53644', '53644\n', 'Infinity', 'NaN', '9007199254740992'])('rejects invalid current package build %j', (build) => {
    info.QQPackageInfo!.buildVersion = build;
    expect(() => info.requireMinNTQQBuild('40768')).toThrow('QQ当前构建号无效');
  });

  it('rejects a missing current build instead of selecting an older API branch', () => {
    delete (info.QQPackageInfo as Partial<QQPackageInfoType>).buildVersion;
    info.QQPackageInfo!.version = '3.2.99';
    expect(() => info.requireMinNTQQBuild('40768')).toThrow('QQ当前构建号无效');
  });

  it('does not hide a corrupt active quick-update build behind the package build', () => {
    info.isQuickUpdate = true;
    info.QQVersionConfig!.curVersion = '3.2.99-99999-broken';
    info.QQVersionConfig!.buildId = '99999';
    expect(() => info.requireMinNTQQBuild('40768')).toThrow('QQ当前构建号无效');
  });

  it.each(['', 'broken', '40768bad', '0', '-1', '40768.5', ' 40768', '40768\n', 'Infinity', 'NaN', '9007199254740992'])('rejects invalid minimum build %j', (build) => {
    expect(() => info.requireMinNTQQBuild(build)).toThrow('QQ最低构建号无效');
  });
});
