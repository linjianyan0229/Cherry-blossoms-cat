import type { RequestHandler } from 'express';
import fs from 'node:fs';
import { sendSuccess, sendError } from '@/napcat-webui-backend/src/utils/response';
import { webUiPathWrapper, webUiLogger } from '../../index';
import type { NapCatPathWrapper } from '@/napcat-common/src/path';
import { WebUiDataRuntime } from '@/napcat-webui-backend/src/helper/Data';
import { NapCatCoreWorkingEnv } from '@/napcat-webui-backend/src/types';
import { getProjectRelease } from 'napcat-common/src/project-release';
import { PROJECT_RELEASES_URL, type ProjectRuntime } from 'napcat-common/src/project-repository';
import type { ILogWrapper } from '@/napcat-common/src/log-interface';
import {
  applyVerifiedUpdate, assertUpdateVersion, pendingUpdatePath, removeUpdateStage,
  stageProjectUpdate, validatePendingUpdate, writePendingUpdate,
} from '@/napcat-webui-backend/src/helper/project-update';
import type { ProjectPendingUpdate } from '@/napcat-webui-backend/src/helper/project-update';

let updateInProgress = false;

export const UpdateNapCatHandler: RequestHandler = async (req, res) => {
  if (process.env['NAPCAT_IMAGE_MANAGED'] === '1' || Boolean(process.env['IMAGE_QQ_VERSION'])) {
    sendError(res, `此实例由 Docker 镜像管理。请从 ${PROJECT_RELEASES_URL} 获取本项目镜像更新包，在主机部署目录执行 update.sh；容器内文件不直接更新。`);
    return;
  }
  if (updateInProgress) { sendError(res, '已有项目更新进行中，请等待完成'); return; }
  updateInProgress = true;
  let staged: ProjectPendingUpdate | undefined;
  let registered = false;
  try {
    const { targetVersion, force, mirror } = req.body || {};
    if (targetVersion !== undefined && (typeof targetVersion !== 'string' || !targetVersion.trim())) throw new Error('目标项目版本无效');
    if (force !== undefined && typeof force !== 'boolean') throw new Error('强制更新标记必须为布尔值');
    if (mirror !== undefined && mirror !== '') throw new Error('项目更新仅使用本项目 GitHub，不支持其他下载源');
    const target = targetVersion?.trim() || 'latest';
    if (target.startsWith('action-')) throw new Error('临时 Actions 构建不作为可安装版本，请选择本项目已发布 Release');
    const environment = WebUiDataRuntime.getWorkingEnv();
    if (environment !== NapCatCoreWorkingEnv.Shell && environment !== NapCatCoreWorkingEnv.Framework) throw new Error('无法确认当前 Shell/Framework 运行类型');
    if (fs.existsSync(pendingUpdatePath(webUiPathWrapper))) throw new Error('存在尚未完成或旧格式的待更新记录，请先由维护者处理后再更新');
    const release = await getProjectRelease(target);
    assertUpdateVersion(WebUiDataRuntime.GetNapCatVersion(), release.version, force === true);
    const runtime = environment === NapCatCoreWorkingEnv.Framework ? 'Framework' : 'Shell';
    const update = await stageProjectUpdate(webUiPathWrapper, release, runtime);
    staged = update;
    // Save provenance first so interrupted replacements can be resumed offline.
    writePendingUpdate(webUiPathWrapper, update);
    registered = true;
    const remaining = applyVerifiedUpdate(webUiPathWrapper, update, (file, error) => webUiLogger?.logError(`[Project Update] 无法替换 ${file}，将于重启时重试：`, error), runtime);
    if (remaining.length) writePendingUpdate(webUiPathWrapper, { ...update, files: remaining });
    else { fs.unlinkSync(pendingUpdatePath(webUiPathWrapper)); removeUpdateStage(webUiPathWrapper, update.stageName); }
    sendSuccess(res, {
      status: 'completed', newVersion: release.version, failedFilesCount: remaining.length,
      message: remaining.length
        ? `发行包已校验，请手动重启以应用剩余 ${remaining.length} 个文件${remaining.some(file => file.relativePath === 'napcat.mjs') ? '；核心入口在启动后替换，可能还需再次手动重启才能载入新核心' : ''}`
        : '发行包已校验并替换，请手动重启应用',
    });
  } catch (error) {
    if (staged && !registered) {
      try { removeUpdateStage(webUiPathWrapper, staged.stageName); }
      catch (cleanupError) { webUiLogger?.logError('[Project Update] 无法清理本次临时目录：', cleanupError); }
    }
    webUiLogger?.logError('[Project Update] 更新失败：', error);
    sendError(res, error instanceof Error ? error.message : '项目更新失败');
  } finally { updateInProgress = false; }
};

/** Preserve records from the upstream updater; never execute their absolute paths. */
export async function applyPendingUpdates (paths: NapCatPathWrapper, logger: ILogWrapper, expectedRuntime: ProjectRuntime): Promise<void> {
  const record = pendingUpdatePath(paths);
  if (!fs.existsSync(record)) return;
  if (process.env['NAPCAT_IMAGE_MANAGED'] === '1' || Boolean(process.env['IMAGE_QQ_VERSION'])) { logger.logWarn('[Project Update] 镜像管理实例保留待更新记录，不修改容器发行文件'); return; }
  try {
    const stat = fs.lstatSync(record);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('待更新记录不是普通文件');
    const update = validatePendingUpdate(paths, JSON.parse(fs.readFileSync(record, 'utf8')), expectedRuntime);
    const remaining = applyVerifiedUpdate(paths, update, (file, error) => logger.logError(`[Project Update] 重启后仍无法替换 ${file}：`, error), expectedRuntime);
    if (update.files.some(file => file.relativePath === 'napcat.mjs') && !remaining.some(file => file.relativePath === 'napcat.mjs')) {
      logger.logWarn('[Project Update] 核心入口已替换，但当前进程仍执行已载入版本；请再次手动重启以载入新核心，本次不会自动重启。');
    }
    if (remaining.length) writePendingUpdate(paths, { ...update, files: remaining });
    else { fs.unlinkSync(record); removeUpdateStage(paths, update.stageName); logger.log('[Project Update] 本项目待更新文件已应用'); }
  } catch (error) {
    logger.logWarn('[Project Update] 拒绝来源不明、旧格式或校验失败的待更新记录，原记录已保留：', error);
  }
}
