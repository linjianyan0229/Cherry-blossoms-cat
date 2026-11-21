# [**Cherry-blossoms-cat**](https://github.com/linjianyan0229/Cherry-blossoms-cat)

**Cherry-blossoms-cat** 是一条面向个人使用的 NapCat 源码维护分支。项目以 NapCat `v4.18.42` 源码快照为基线，持续跟进 QQ/NTQQ 客户端版本变化，首个内测版本为 `0.0.1`。

本仓库的项目名称和发行包名称为 Cherry-blossoms-cat；底层核心源自 NapCat，保留原有版权、许可证和各组件的第三方许可声明。它不是对 NapCat 原项目来源或权利的替代声明。

## 内测发行包

GitHub Actions 会在推送 `v*` 版本标签时构建 Shell 和 Framework 发行包，并将它们作为 GitHub 预发行版附件发布。首版内测使用标签 `v0.0.1`。

发布附件：

- `Cherry-blossoms-cat-Shell-0.0.1.zip`：Shell 运行包
- `Cherry-blossoms-cat-Framework-0.0.1.zip`：Framework 运行包
- `SHA256SUMS.txt`：附件校验值

构建工作流仅负责打包，不在 GitHub Runner 上执行测试。所有类型检查和项目测试都必须在 [指定的隔离测试服务器](TESTING.md) 上执行。

## 主要功能

- Shell 和 Framework 两种运行方式。
- 基于 QQ/NTQQ 原生 `wrapper.node` 接入客户端会话，并通过 OneBot 11 暴露机器人 API 和事件。
- 提供 WebUI 用于登录、网络配置和插件管理。
- 支持按配置启用 OneBot HTTP、HTTP SSE、HTTP 回调、正向 WebSocket 和反向 WebSocket。
- 带有针对 QQ 客户端版本、Build、平台和架构的兼容性适配。

## 安装与使用

1. 在 [Releases](https://github.com/linjianyan0229/Cherry-blossoms-cat/releases) 下载与你的部署方式匹配的 Shell 或 Framework 包。
2. 依照随包目录结构部署，并按运行模式准备对应的 QQ/NTQQ 客户端及运行环境。
3. 启动后在 WebUI 中登录并按需配置 OneBot 连接与访问令牌。
4. 首次用于重要账号前，先在隔离环境验证登录、消息收发、重连和插件行为。

本仓库发布的是核心运行包，不包含 QQ 客户端。运行时需要匹配环境提供的 QQ 文件及原生模块。

## QQ/NTQQ 版本兼容

Cherry-blossoms-cat 发行版本 `0.0.1` 与 QQ/NTQQ 客户端的版本号是两套独立版本。客户端更新后，应依据完整 QQ 版本、Build、操作系统和架构检查版本参数、`wrapper.node` 接口与 native hook 适配，不能仅凭 TypeScript 构建成功认定客户端兼容。详细维护要点见 [MAINTAINING.md](MAINTAINING.md)。

## 开发和提交

- 项目源码测试只能在 [指定隔离测试服务器](TESTING.md) 的独立容器内运行。
- GitHub Actions 只自动构建发布包，并校验 PR 提交标题格式，不运行项目测试。
- 提交标题严格使用中文格式：`1、功能：中文描述`、`2、修复：中文描述` 或 `3、文档维护：中文描述`。
- `main` 是稳定分支，日常变更走 PR；不得强推或绕过评审直接改写主分支。

细则见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 来源与许可证

核心源码基线为 NapCat `v4.18.42`，原始提交为 `9335843246e3b7a17944861f3ac8731a259732c2`。本分支保留根目录 [LICENSE](LICENSE) 和源码附带的组件许可证。请在修改、分发或改变用途前核对适用授权；第三方组件按其各自许可证处理。
