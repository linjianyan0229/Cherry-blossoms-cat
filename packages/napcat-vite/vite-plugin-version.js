import fs from 'fs';

const repositoryFile = new URL('../napcat-common/src/project-repository.json', import.meta.url);
const sourcePackageFile = new URL('../../package.json', import.meta.url);
const fallbackVersion = '0.0.0-dev';

/** SemVer 2.0: https://semver.org/lang/zh-CN/ */
const SEMVER_REGEX = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export function validateVersion (version) {
  const match = typeof version === 'string' && version.trim().match(SEMVER_REGEX);
  if (!match) {
    return { valid: false, normalized: fallbackVersion, major: 0, minor: 0, patch: 0, prerelease: 'dev', buildmetadata: null };
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const prerelease = match[4] || null;
  const buildmetadata = match[5] || null;
  let normalized = `${major}.${minor}.${patch}`;
  if (prerelease) normalized += `-${prerelease}`;
  if (buildmetadata) normalized += `+${buildmetadata}`;
  return { valid: true, normalized, major, minor, patch, prerelease, buildmetadata };
}

/** A compiled Core reports this build's version, never a remote repository tag. */
export function resolveBuildVersion ({ envVersion, sourceVersion } = {}) {
  if (envVersion !== undefined) {
    const parsed = validateVersion(envVersion);
    if (!parsed.valid) throw new Error('NAPCAT_VERSION 必须是有效的语义版本号');
    return parsed.normalized;
  }
  const source = validateVersion(sourceVersion);
  return source.valid ? source.normalized : fallbackVersion;
}

export default function vitePluginNapcatVersion () {
  return {
    name: 'vite-plugin-napcat-version',
    enforce: 'pre',
    config (userConfig = {}) {
      const repository = JSON.parse(fs.readFileSync(repositoryFile, 'utf8'));
      if (typeof repository.owner !== 'string' || !repository.owner || typeof repository.repo !== 'string' || !repository.repo) {
        throw new Error('项目仓库配置无效');
      }
      let sourceVersion;
      try {
        sourceVersion = JSON.parse(fs.readFileSync(sourcePackageFile, 'utf8')).version;
      } catch {
        // A source-only build without package metadata receives an explicit dev version.
      }
      const tag = resolveBuildVersion({ envVersion: process.env.NAPCAT_VERSION, sourceVersion });
      // Legacy .napcat-version.json caches are never read or written. No network
      // request can label a build with an upstream or unrelated latest version.
      console.log(`[vite-plugin-napcat-version] ${repository.owner}/${repository.repo}: ${tag}`);
      return {
        define: {
          ...(userConfig.define || {}),
          'import.meta.env.VITE_NAPCAT_VERSION': JSON.stringify(tag),
        },
      };
    },
  };
}
