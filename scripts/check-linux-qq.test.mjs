import test from 'node:test';
import assert from 'node:assert/strict';
import { assessPackageValidation, lookupMappings, readOfficialLinux, readPackageVersion, selectLatest, validateManifest } from './check-linux-qq.mjs';

function official (version, updateDate) {
  return {
    Linux: {
      version,
      updateDate,
      x64DownloadUrl: { deb: 'https://qqdl.gtimg.cn/QQ_amd64.deb' },
      armDownloadUrl: { deb: 'https://qqdl.gtimg.cn/QQ_arm64.deb' },
    },
  };
}

test('the stale CDN cannot conceal a newer official proxy release', () => {
  const sources = [readOfficialLinux(official('3.2.34', '2026-09-24'), 'cdn'),
    readOfficialLinux(official('3.2.35', '2026-11-03'), 'proxy')];
  const selected = selectLatest(sources);
  assert.equal(selected.latest.source, 'proxy');
  assert.equal(selected.sourcesDisagree, true);
  assert.equal(selected.versionAndDateConflict, false);
});

test('a version/date reversal is reported instead of treated as a confirmed update', () => {
  const selected = selectLatest([{ version: '3.2.35', updateDate: '2026-11-03' },
    { version: '3.2.36', updateDate: '2026-10-01' }]);
  assert.equal(selected.versionAndDateConflict, true);
});

test('the full build comes from the actual package and inconsistent fields fail', () => {
  assert.deepEqual(readPackageVersion({ version: '3.2.34-53644', buildVersion: '53644' }),
    { fullVersion: '3.2.34-53644', version: '3.2.34', build: '53644' });
  assert.throws(() => readPackageVersion({ version: '3.2.35' }), /完整 version/);
  assert.throws(() => readPackageVersion({ version: '3.2.34-53644', buildVersion: '54276' }), /不一致/);
});

test('missing or non-official download metadata fails before any download is attempted', () => {
  assert.throws(() => readOfficialLinux({ Linux: { version: '3.2.35' } }, 'fixture'), /updateDate/);
  const input = official('3.2.35', '2026-11-03');
  input.Linux.x64DownloadUrl.deb = 'https://example.com/QQ.deb';
  assert.throws(() => readOfficialLinux(input, 'fixture'), /人工核对/);
});

test('x64 keeps its version-only AppID while arm64 uses its explicit override', () => {
  const version = '3.2.34-53644';
  const offsets = { send: 'CBF25A0', recv: 'CBF60E0' };
  const tables = {
    appid: {
      [version]: { appid: 537391664, qua: 'V1_LNX_NQ_3.2.34_53644_GW_B' },
      [`${version}-arm64`]: { appid: '537391665', qua: 'V1_LNX_NQ_3.2.34_53644_GW_B' },
    },
    packet: { [`${version}-x64`]: offsets, [`${version}-arm64`]: offsets },
    napi2native: { [`${version}-x64`]: offsets, [`${version}-arm64`]: offsets },
  };
  assert.deepEqual(lookupMappings(version, 'x64', tables), { appid: true, packet: true, napi2native: true });
  assert.deepEqual(lookupMappings(version, 'arm64', tables), { appid: true, packet: true, napi2native: true });
  delete tables.appid[`${version}-arm64`];
  assert.deepEqual(lookupMappings(version, 'arm64', tables), { appid: false, packet: true, napi2native: true });
  assert.deepEqual(lookupMappings('3.2.35-99999', 'x64', tables), { appid: false, packet: false, napi2native: false });
  assert.throws(() => validateManifest({
    schemaVersion: 1,
    clients: [{
      version: '3.2.35-99999', arch: 'x64', requireMappings: true, validation: 'mapping-only', package: { sha256: null },
    }],
  }, tables), /不一致/);
});

test('same website version does not validate a replacement download or an unchecked archive', () => {
  const installed = readPackageVersion({ version: '3.2.34-53644', buildVersion: '53644' });
  const offsets = { send: 'CBF25A0', recv: 'CBF60E0' };
  const tables = {
    appid: { '3.2.34-53644': { appid: 537391664, qua: 'V1_LNX_NQ_3.2.34_53644_GW_B' } },
    packet: { [`${installed.fullVersion}-x64`]: offsets },
    napi2native: { [`${installed.fullVersion}-x64`]: offsets },
  };
  const clients = [{
    version: installed.fullVersion,
    arch: 'x64',
    validation: 'login-verified',
    package: {
      url: 'https://qqdl.gtimg.cn/old.deb', sha256: 'a'.repeat(64), updateDate: '2026-09-24',
    },
  }];
  const latest = { version: '3.2.34', updateDate: '2026-09-24', downloads: { x64: clients[0].package.url } };
  assert.equal(assessPackageValidation(installed, 'x64', clients, tables, latest).currentOfficialPackageValidated, false);
  assert.equal(assessPackageValidation(installed, 'x64', clients, tables, latest, 'a'.repeat(64)).currentOfficialPackageValidated, true);
  latest.downloads.x64 = 'https://qqdl.gtimg.cn/new.deb';
  const replaced = assessPackageValidation(installed, 'x64', clients, tables, latest, 'a'.repeat(64));
  assert.equal(replaced.installedBuildVerified, true);
  assert.equal(replaced.currentOfficialPackageValidated, false);
  assert.equal(replaced.fullBuildRequiresPackageInspection, true);
});
