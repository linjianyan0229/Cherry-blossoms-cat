import { RequestHandler } from 'express';
import { WebUiDataRuntime } from '@/napcat-webui-backend/src/helper/Data';
import { sendSuccess, sendError } from '@/napcat-webui-backend/src/utils/response';
import { WebUiConfig, webUiPathWrapper } from '@/napcat-webui-backend/index';
import { getProjectRelease, getProjectReleases } from '@/napcat-common/src/project-release';
import { PROJECT_REPOSITORY, PROJECT_RELEASES_URL } from '@/napcat-common/src/project-repository';
import { getMirrorConfig } from '@/napcat-common/src/mirror';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const GetNapCatVersion: RequestHandler = (_, res) => {
  sendSuccess(res, {
    version: WebUiDataRuntime.GetNapCatVersion(),
    updateMode: process.env.NAPCAT_IMAGE_MANAGED === '1' || !!process.env.IMAGE_QQ_VERSION ? 'image' : 'files',
    repository: PROJECT_REPOSITORY,
    releaseUrl: PROJECT_RELEASES_URL,
  });
};

export const getLatestTagHandler: RequestHandler = async (_, res) => {
  try {
    const release = await getProjectRelease('latest');
    sendSuccess(res, release.version);
  } catch (error) {
    sendError(res, `无法读取本项目最新发行：${(error as Error).message}`);
  }
};

export interface VersionInfo {
  tag: string;
  type: 'release' | 'prerelease' | 'action';
  artifactId?: number;
  artifactName?: string;
  createdAt?: string;
  expiresAt?: string;
  size?: number;
  workflowRunId?: number;
  headSha?: string;
  workflowTitle?: string;
}

export const getAllReleasesHandler: RequestHandler = async (req, res) => {
  try {
    const positive = (value: unknown, fallback: number, max: number) => {
      const parsed = Number(value);
      return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
    };
    const page = positive(req.query['page'], 1, 10000);
    const pageSize = positive(req.query['pageSize'], 20, 100);
    const type = req.query['type'];
    const search = String(req.query['search'] || '').toLowerCase().trim();
    // Online updates use published assets from this repository. Build artifacts
    // are review packages and cannot be selected as an installed release.
    const releases = type === 'action' ? [] : await getProjectReleases();
    const versions: VersionInfo[] = releases.map((release): VersionInfo => ({
      tag: release.tag_name,
      type: release.prerelease ? 'prerelease' : 'release',
    })).filter(release => !search || release.tag.toLowerCase().includes(search));
    const total = versions.length;
    sendSuccess(res, {
      versions: versions.slice((page - 1) * pageSize, page * pageSize),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      mirror: '',
      repository: PROJECT_REPOSITORY,
      sourceUrl: PROJECT_RELEASES_URL,
    });
  } catch (error) {
    sendError(res, `无法读取本项目发行列表：${(error as Error).message}`);
  }
};

export const QQVersionHandler: RequestHandler = (_, res) => {
  sendSuccess(res, WebUiDataRuntime.getQQVersion());
};

export const GetThemeConfigHandler: RequestHandler = async (_, res) => {
  sendSuccess(res, await WebUiConfig.GetTheme());
};

export const SetThemeConfigHandler: RequestHandler = async (req, res) => {
  await WebUiConfig.UpdateTheme(req.body.theme);
  sendSuccess(res, { message: '更新成功' });
};

export const GetMirrorsHandler: RequestHandler = (_, res) => {
  sendSuccess(res, { mirrors: getMirrorConfig().fileMirrors });
};

export const GetNapCatFileHashHandler: RequestHandler = (_, res) => {
  try {
    const filePath = path.join(webUiPathWrapper.binaryPath, 'napcat.mjs');
    const hash = crypto.createHash('sha512').update(fs.readFileSync(filePath)).digest('hex');
    sendSuccess(res, { hash, file: 'napcat.mjs', algorithm: 'sha512' });
  } catch (error) {
    sendError(res, `无法计算 napcat.mjs 的 hash：${(error as Error).message}`);
  }
};
