'use strict';

// This entry is loaded by QQ's own Electron main process, never system Node.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

try {
  if (process.platform !== 'linux' || !process.versions.electron) throw new Error('Shell 核心需要 QQ 自身的 Linux Electron 主进程');
  const runtime = process.env.NAPCAT_LINUX_RUNTIME;
  const main = process.env.NAPCAT_MAIN_PATH;
  const data = process.env.NAPCAT_QQ_DATA_DIR;
  if (!runtime || !main || !data || !process.env.NAPCAT_WORKDIR) throw new Error('请通过 launcher-linux.sh 启动');
  if (fs.existsSync(path.join(path.dirname(main), 'config', '.env'))) throw new Error('发行目录 config/.env 会覆盖启动参数，请先移走该文件');

  process.env.NAPCAT_WRAPPER_PATH = path.join(runtime, 'qq/resources/app/wrapper.node');
  process.env.NAPCAT_QQ_PACKAGE_INFO_PATH = path.join(runtime, 'qq/resources/app/package.json');
  process.env.NAPCAT_QQ_VERSION_CONFIG_PATH = path.join(runtime, 'qq-version.json');
  process.env.NAPCAT_DISABLE_MULTI_PROCESS = '1';
  process.env.NAPCAT_DISABLE_PIPE = '1';

  // Chromium storage also belongs to the selected QQ data directory.
  const chromiumData = path.join(data, 'chromium');
  fs.mkdirSync(chromiumData, { recursive: true, mode: 0o700 });
  const { app } = require('electron');
  app.setPath('userData', chromiumData);
  app.setPath('sessionData', chromiumData);

  const qq = JSON.parse(fs.readFileSync(process.env.NAPCAT_QQ_PACKAGE_INFO_PATH, 'utf8'));
  console.log(`Cherry-blossoms-cat Linux：QQ ${qq.version}，${process.arch}，Electron ${process.versions.electron}，Node ${process.versions.node}`);
  import(pathToFileURL(main).href).catch(error => {
    console.error('Shell 加载失败：', error.message);
    process.exit(1);
  });
} catch (error) {
  console.error('Linux 引导失败：', error.message);
  process.exit(1);
}
