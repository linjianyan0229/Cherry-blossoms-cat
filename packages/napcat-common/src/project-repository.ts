import repository from './project-repository.json';
import { parseSemVer } from './version';

export const PROJECT_OWNER = repository.owner;
export const PROJECT_NAME = repository.repo;
export const PROJECT_REPOSITORY = `${PROJECT_OWNER}/${PROJECT_NAME}`;
export const PROJECT_GITHUB_URL = `https://github.com/${PROJECT_REPOSITORY}`;
export const PROJECT_API_URL = `https://api.github.com/repos/${PROJECT_REPOSITORY}`;
export const PROJECT_RELEASES_URL = `${PROJECT_GITHUB_URL}/releases`;

export type ProjectRuntime = 'Shell' | 'Framework';

export function getProjectAssetName (runtime: ProjectRuntime, version: string): string {
  const parsed = parseSemVer(version);
  if (!parsed.valid) throw new Error('项目发行版本号无效');
  return `${PROJECT_NAME}-${runtime}-${parsed.normalized}.zip`;
}
