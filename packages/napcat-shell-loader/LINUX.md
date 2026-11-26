# Cherry-blossoms-cat Linux Shell 启动器

此启动器使用用户提供的 Linux QQ 安装树，在用户工作目录复制完整运行副本，通过 QQ 自身的定制 Electron 主进程运行 Shell。系统 Node.js 只处理 JSON 和文件准备，不执行 `napcat.mjs`。原 QQ 安装目录和发行包不被修改。

已真实验证 Linux x64 的 QQ **3.2.34-53644**：QQ Electron **40.0.0** / Node **24.11.1**，原生 packet/napi 模块加载、packet 初始化、WebUI 鉴权和扫码等待阶段正常。Linux arm64 已有原生文件和版本参数映射，但尚未完成真机启动验证；其他 QQ 版本也需重新核对原生接口与偏移适配。旁路函数的整体成功返回不能证明六项检测绕过全部生效。

**0.0.1** 的公开 Docker 包固定使用已完成登录验证的 **3.2.34-53644 x64**。QQ 运行时为 Electron 40.0.0 / Node 24.11.1；使用发行包前仍应按完整 QQ Build 核对兼容性。更新的 **3.2.35-54395 x64** packet/napi Hook 适配仍记录在 `LINUX_QQ_MAINTENANCE.md` 和 `compatibility/evidence/` 中，暂不作为本公开 Docker 包的固定客户端。

## 前置条件

- 普通用户有可读、可执行的 QQ 安装树，根目录包含 `qq`、`resources/app/package.json` 和 `resources/app/wrapper.node`。
- 已解压完整 Shell 发行包，保留 `node_modules`、`native`、`static`、`config`、项目文档和许可证目录。
- 系统 Node.js 20 或更新版本、Bash、`flock`（util-linux）。启动器不下载、安装软件或执行 `sudo`。
- QQ 所需共享库已由系统提供。有显示环境时需要可用的 `DISPLAY`；无显示环境时需要 Xvfb 的 `xvfb-run` 和 `xauth`。

第一版只接受安装目录，不解包 `.deb`、`.rpm` 或 AppImage。`resources/app` 必须是实际目录；被 `app.asar` 遮蔽或具有其他启动布局的客户端不在当前验证范围。

## 启动

```bash
bash /path/to/Shell/launcher-linux.sh \
  --qq /path/to/QQ \
  --workdir "$HOME/.local/share/Cherry-blossoms-cat" \
  --display auto
```

`--shell` 默认是启动器所在目录，也可以指向另一个完整发行包。`--workdir` 默认读取 `NAPCAT_WORKDIR`，否则使用 `${XDG_DATA_HOME:-$HOME/.local/share}/Cherry-blossoms-cat`。`--qq-data-dir` 默认读取 `NAPCAT_QQ_DATA_DIR`，否则使用工作目录的 `qq-data` 子目录。

工作目录必须与 QQ 安装目录、Shell 发行目录分开；QQ 数据目录不能与安装、发行或运行副本目录重叠。准备目录必须属于当前用户。工作目录需要足够空间存放完整 QQ 副本。

`--display system` 使用已有 `DISPLAY`；`--display xvfb` 使用 `xvfb-run -a`；`auto` 在有 `DISPLAY` 时选择 system，否则选择 xvfb。启动器不会启用 `ELECTRON_RUN_AS_NODE`，也不会通过独立 Node 或预加载系统库运行核心。

`--no-sandbox` 是显式可选项，适用于已确认隔离且无法使用 Chromium 沙箱的环境。用户副本无法保留 root 所有权的 setuid sandbox helper；默认启动可能出现 SUID sandbox 错误或受系统用户命名空间策略限制。当前真实验证使用隔离容器和显式 `--no-sandbox`，没有验证桌面默认沙箱方式。启动器不会自动降低沙箱设置。远端隔离容器的启动示例：

```bash
bash /path/to/Shell/launcher-linux.sh --qq /path/to/QQ \
  --workdir /test/work --qq-data-dir /test/qq-data \
  --display xvfb --no-sandbox
```

Shell 在 QQ 主进程中以单进程模式运行，命名管道关闭。已有配置和 QQ 数据保持原样；新的工作目录仅在缺少 `config/napcat.json` 时复制发行默认文件。启动器不添加快捷账号或密码，是否登录取决于所选 QQ 数据和用户配置。隔离验证必须指定全新 QQ 数据并清除快捷登录环境变量。

发行目录的 `config/.env` 会覆盖 Shell 的环境变量。第一版检测到这个文件就拒绝准备或启动，不读取、打印其内容，也不修改核心的 `.env` 优先级。请将配置移到明确的工作目录或使用环境变量。

## 准备、恢复与版本更新

```bash
# 仅准备文件；不会启动 QQ 或 Shell，也不需要显示服务。
bash /path/to/Shell/launcher-linux.sh --qq /path/to/QQ \
  --workdir /path/to/work --prepare-only

# 必须在同一工作目录没有运行中的启动器时执行。
bash /path/to/Shell/launcher-linux.sh --workdir /path/to/work --restore
```

副本位于 `WORKDIR/linux-qq-runtime/qq`。原始 `package.json` 字节保存在 `WORKDIR/linux-qq-runtime/original-package.json`；仅副本的 `main` 改为相对入口 `./cherry-linux-bootstrap.cjs`，其他元数据保留。`qq-version.json` 根据真实 package 版本生成，避免误用桌面 QQ 的 HOME 快更配置。

同一工作目录使用 `flock`，锁会一直保持到 QQ 启动进程退出。恢复先校验专用目录、备份及当前入口哈希，仅按备份原始字节还原副本的 `package.json`，不删除配置、会话、QQ 数据或其他安装目录。入口或引导文件被其他工具修改时拒绝覆盖。恢复后再次启动会重新设置副本入口。

QQ 源目录或源文件版本变化时，已有副本不会被静默替换；请为新 QQ 版本选择新的工作目录。需要继续使用同一份 QQ 数据时，可显式指定原先的 `--qq-data-dir`。更换 Shell 发行目录可重新准备同一 QQ 副本。

## 维护验证与许可证

所有准备验证、语法检查、构建、测试及实际启动都必须在维护者指定远端服务器的全新专用隔离容器中完成，遵守发行包里的 `TESTING.md`。GitHub Actions 只做授权的发行构建和打包，不启动 QQ 或运行项目测试。现有已登录实例不得因启动器验证而修改、重启或再次登录。

文件准备验证应检查原 QQ 安装树哈希不变、元数据除 `main` 外一致、备份字节完全恢复、路径含空格、配置不被覆盖、`.env` 拒绝和目录锁；这些只验证文件操作。真实兼容性需另用官方 QQ 的新容器验证定制 runtime、原生模块、WebUI 和扫码等待阶段，不以模拟导出代替原生加载。

该项目来源为 NapCat v4.18.42。分发 Shell 时必须保留根 `LICENSE`、组件许可证及来源文档；Shell ZIP 不携带 QQ 客户端。Docker 发行单独核验并保留官方 QQ 安装树及版权材料，见 `DOCKER.md`。本启动器的本地副本保留用户提供的 QQ 文件和版权材料。
