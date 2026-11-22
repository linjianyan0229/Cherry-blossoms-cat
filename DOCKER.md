# Cherry-blossoms-cat Docker 内测包

Docker 发行使用同一次 GitHub Actions 构建的 Shell ZIP，不重复编译项目。本轮 **0.0.2-rc.1 新 QQ 预览**镜像只支持 **Linux amd64**，包含锁定的 **QQ 3.2.35-54395** 完整安装树、系统依赖和 Shell；QQ 核心运行于客户端自身的定制 Electron。指定远端新隔离实例已完成扫码登录，正常 engine 启动后 napi 首次初始化返回 `true`，同进程 packet 持续产生双向协议包回调；最近联系人、群历史和按 ID 读取消息均成功。尚未验证主动发送消息、长期事件推送或反检测效果。

QQ **3.2.34-53644** 保留为历史已登录验证基线。预览使用独立项目和全新 profile，不自动替换已有已登录实例。构建清单中的 QQ pin 仍按最低启动验证等级审核，不能由镜像构建成功推断账号或消息兼容；新 QQ 预览仅以预发布版本发行。

每个 `v*` 发行标签构建 GHCR 版本镜像与 `latest` 标签，同时在 GitHub Release 附加离线镜像、部署 ZIP、镜像身份/来源和 SHA-256。`latest` 代表最近成功发布的内测构建；旧标签重跑、不同标签并发后，它不保证最高语义版本，也不表示稳定版。Docker job 使用共享发布锁，避免版本与 latest 的推送相互交错。手动运行工作流只生成 Actions 构建产物，不推镜像或发布 Release。构建过程不运行 QQ、项目测试或应用健康检查。

GitHub 并发锁只保留一个运行作业和一个待运行作业；密集推送多个标签时，被替换取消的 Docker job 需要在 Actions 中重新运行。常规发行应等待当前 Docker job 完成后再发下一标签。

## 首次部署

下载相同 Release 的 `*-Docker-deploy-*.zip`，解压到专门的个人预览部署目录。部署 ZIP 中的 `.env` 只包含镜像版本、QQ Build 和 Compose 项目名称，没有账号或令牌。本预览默认 `COMPOSE_PROJECT_NAME=cherry-cat-preview`，首次使用全新账号数据卷；请勿把旧版账号数据挂进预览。先查看 `.env` 和 `compose.yml`，再执行：

```bash
docker compose pull cherry
docker compose up -d cherry
docker compose logs -f cherry
```

GHCR 新镜像默认可能为私有包；个人使用可保持私有。拉取私有包前，用有该包读取权限的 GitHub 凭据执行 `docker login ghcr.io`。登录凭据保存在主机 Docker 配置中，不写入部署 `.env`，也不挂载到 QQ 容器。

扫码链接和 WebUI 鉴权信息可在本实例日志中查看。WebUI 只绑定主机回环地址 `http://127.0.0.1:6099`。在远端个人部署时，可用自己的 SSH 本地转发访问；不需要把管理端口开放到公网。QQ 数据和日志包含个人信息，不应发布到仓库或 Release。

镜像使用 UID/GID `1000:1000`。Compose 设置只读根文件系统、移除全部 capabilities、`no-new-privileges`、专用 bridge、进程/内存限制和临时 Xvfb 目录。QQ 使用显式 `--no-sandbox`，外层 Docker 隔离是此模式的前置条件。此例不挂载 Docker socket、SSH agent 或主机生产目录。

运行卷至少预留 **2 GB** 可用空间，建议主机有 **2 GB** 以上内存；完整 QQ 副本不能放在小容量或 `noexec` 临时目录。不要以 root、`--privileged` 或 host network 覆盖发行设置。Linux arm64 尚未完成同等验证，没有对应镜像标签。

## 配置、账号与版本更新

WebUI 的版本检测固定查询 [本仓库 Releases](https://github.com/linjianyan0229/Cherry-blossoms-cat/releases)，包含完整的已发布预发行版，按语义版本排序，不使用上游版本或 Actions 临时包。镜像设置 `NAPCAT_IMAGE_MANAGED=1`，WebUI 和后端均阻止容器内文件更新；检测到新版本后请按下面的宿主机更新流程操作。此行为需要使用包含更新源修复的新构建，旧镜像不会因仓库合并自动获得修复。

Compose 的 `profile` 卷持久化 QQ 数据及客户端 HOME；`config` 卷保存 Shell/WebUI 配置，`plugins` 卷保存用户插件。内置插件来自同次编译的发行包，仅在插件卷缺少 `napcat-plugin-builtin` 目录时初始化，不覆盖已有插件。`runtime` 卷存放工作目录、缓存、日志及完整 QQ 运行副本，其名字含 QQ Build。首次使用空卷时 Docker 从镜像目录继承 UID 1000 的所有权；已有 bind mount 需要维护者自行准备合适权限。

发行 `.env` 默认锁定完整版本。更新 Shell 时保留同一 Compose 项目名称，先将 `.env` 中 `CHERRY_IMAGE` 改为目标完整版本（或 Release 记录的 registry digest），然后执行：

```bash
bash ./update.sh
```

此脚本先拉取目标镜像，成功后只重建本部署的 `cherry` 服务，不删除卷。它显式使用脚本目录的 `.env` 和项目名称，忽略调用者导出的同名镜像/项目变量；`COMPOSE_PROJECT_NAME` 应使用发行模板中的无引号小写名称格式。它不安装常驻更新服务，也不访问其他容器。GitHub 自动构建发行包，现有运行实例按上述命令更新；镜像不自动升级 QQ 客户端，也不会自行更改目标镜像版本。

将来 QQ Build 更新时，还应将 `CHERRY_QQ_VERSION` 改为该 Release 的锁定版本。Compose 会创建新的 QQ 运行卷，共享原来的配置、插件和 QQ 数据；旧运行卷保留。镜像入口核对客户端版本，版本不一致时拒绝启动。不要用同一个 QQ profile 同时启动两份实例。切换客户端前应停止实例并备份卷；客户端可能迁移账号数据库，旧镜像不能保证读回迁移后的数据，回滚应连同更新前的备份恢复。

不要运行 `docker compose down -v`，它会删除持久化数据。复制新部署包时保留自己的项目名称、WebUI 端口及数据卷配置；仅更新镜像和相应 QQ Build。容器内 Shell 文件为只读，升级通过替换镜像完成。

## 离线部署

从同一个 Release 下载 `*-Docker-linux-amd64-*.tar.gz`、部署 ZIP 与 `DOCKER-SHA256SUMS.txt`，放在同一目录：

```bash
sha256sum --check DOCKER-SHA256SUMS.txt
docker load --input Cherry-blossoms-cat-Docker-linux-amd64-0.0.2-rc.1.tar.gz
# 解压部署 ZIP，并在其目录中执行；.env 必须使用离线包记录的版本标签。
docker compose up -d --pull never cherry
```

上面的文件名是命名示例，实际以下载的 Release 文件名为准。离线 tar 保存版本标签，`latest` 仍是线上可变标签。`image.json` 中的 `imageId` 是构建机 Docker 引擎报告的 ID，`imageIdKind=builder-engine`；containerd 与 legacy image store 对同一归档可能报告不同 ID，不能拿它直接核对跨 store 的离线加载结果。`configDigest` 则是归档 `manifest.json` 的 Config 所指文件原始字节的 SHA-256，可用于跨 store 核对镜像配置身份。`registryDigest` 仍用于 GHCR 拉取身份，手动工作流的离线包中该项为 `null`。

部署包包含只读取归档的 `archive-config-digest.cjs`。在提供系统 Node.js 和 tar 的环境中，可按实际离线文件名执行：

```bash
node ./archive-config-digest.cjs ../Cherry-blossoms-cat-Docker-linux-amd64-0.0.2-rc.1.tar.gz
```

输出应与 `image.json` 的 `configDigest` 一致。读取器仅接受 `64位hash.json` 或 `blobs/sha256/64位hash` 配置路径，并核对路径摘要与真实文件 SHA-256；不解包到文件系统、不加载镜像或启动应用。该配置摘要与 `DOCKER-SHA256SUMS.txt` 的完整归档校验共同使用。

## 维护与来源

项目来源为 NapCat v4.18.42，Shell 中保留原始许可证和组件来源。QQ 的完整 DEB 文件载荷保存在镜像的 `/opt/qq-distribution`；来源、字节数和 SHA-256 记录于 `docker/qq-client.json`、`docker/QQ-SOURCE.md` 及 Release 的 `image.json`。QQ 版权与使用条款仍属于相应权利人；文件 SHA-256 是项目完整性记录，不是腾讯数字签名。

维护者必须遵守 `TESTING.md`：所有 Docker 开发构建验证、文件准备检查和真实启动验证，只能在指定远端服务器的新隔离容器中执行。验证不用此个人部署 Compose：测试必须使用全新数据、专用 bridge 且不发布任何端口。不得以验证为由重启或修改已有已登录实例。GitHub Actions 的例外仅限经用户授权的发行构建和打包。
