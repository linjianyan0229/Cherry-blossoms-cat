# Linux QQ 版本维护

当前维护优先跟进 Linux QQ x64。项目发行版本、QQ 完整版本、QQ Build、平台和架构分别记录；其他架构须独立验证后才提升支持级别。源码基线与许可见 [MAINTAINING.md](MAINTAINING.md)。

## 官方版本来源

官网使用两个公开配置地址：

- [官网代理](https://im.qq.com/proxy/domain/qq-web.cdn-go.cn/im.qq.com_new/latest/rainbow/pcConfig.json)。
- [CDN 直连](https://qq-web.cdn-go.cn/im.qq.com_new/latest/rainbow/pcConfig.json)。

2026-11-22 核对时，官网代理返回 Linux **3.2.35 / 2026-11-03**，CDN 仍返回 **3.2.34 / 2026-09-24**。检查器读取两个来源，比较版本与日期并报告不同步。网页 `Linux.version` 不含 Build；完整版本须取自 DEB 控制 `Version` 或包内 `resources/app/package.json`。MIPS 等架构可能仍指向旧包，不能套用顶层 Linux 版本。

新 Linux x64 包已读取为 **3.2.35-54395**。官方地址在指定服务器返回 403，本轮使用与官网文件名相同的公开镜像资产作临时验证输入；188287504 字节，SHA256 为 `7de03862327abbd16da27130413698c9517782b27194afc593bc3abf9b55f9ac`。这是镜像资产摘要，不是腾讯发布的签名或校验值。包来源记录在维护清单，QQ 本体不进入项目发行包。

## 清单与检查

[compatibility/linux-qq.json](compatibility/linux-qq.json) 保存完整版本、架构、来源与验证级别：`login-verified`、`startup-verified`、`mapping-only`、`metadata-only`。消息收发和反检测效果另行记录，不从启动或原生成功返回推断。

以下命令由维护者在源码 checkout 中、且仅在 [指定远端隔离容器](TESTING.md) 中执行：

```bash
# 校验明确纳入清单的 AppID 和两个原生偏移表，不联网、不启动 QQ。
node scripts/check-linux-qq.mjs --check

# 核对两个官方配置源，以及实际安装包的完整 Build。
node scripts/check-linux-qq.mjs --qq-package /path/to/QQ/resources/app/package.json \
  --qq-deb /path/to/QQ.deb --arch x64

# 使用保存的两份官方原文重现来源差异。
node scripts/check-linux-qq.mjs --metadata /fixtures/official-pcConfig.json \
  --metadata /fixtures/official-pcConfig-cdn.json \
  --qq-package /path/to/QQ/resources/app/package.json --qq-deb /fixtures/QQ.deb --arch x64
```

退出码 `0` 表示检查通过；`1` 表示输入、清单或请求无法解析；在线核对的 `2` 表示需要完整包验证、补适配或处理来源失败/版本日期冲突。`--check` 只检查维护清单，不能与安装包或元数据参数组合。检查器分别记录安装的完整 Build 是否已验证，以及当前官网 URL、日期、实际 DEB 哈希是否与记录一致；仅网页版本相同或已有旧安装包不等于当前下载已验证。旧 AppID 中的历史客户端原本不全支持 Napi2Native，只有清单中 `requireMappings=true` 的版本强制要求完整映射；ARM64 必须有架构专属 AppID。

## 每个新版本的步骤

1. 保存两个官方配置响应，核对目标架构的真实下载地址与发布日期。
2. 在专用隔离目录获取包并记录来源、大小和 SHA256；在隔离容器解包，核对完整版本、Build、架构、布局与实际 Electron/Node。保留旧实例作为基线，不替换其客户端或会话。
3. 核对 `qq-basic-info.ts`、`appid.json`、`wrapper.node` 服务声明及 Build 分支。只扫描一个架构时写架构专属 AppID 条目；新 3.2.35 x64 的 `537403759` 来自 `major.node` 的 `QQAppId/` 标记。
4. 分别核对 `packet.json`、`napi2native.json` 和对应 `.node`。偏移必须来自本版本同架构的可复核证据，不沿用其他版本地址；缺偏移时记录未适配。
5. 在新隔离容器执行版本回归、类型检查、Linux 文件准备/恢复、构建和真实无登录启动。登录和消息验证使用专用测试账号与明确测试对象。记录实际验证范围后更新清单。

新 Linux 启动器在专用工作目录复制完整 QQ，备份原始入口并生成独立版本配置，避免误取桌面 QQ 的 HOME 快更信息。相对入口由 QQ 自身运行时加载；系统 Node 只准备文件。使用与恢复见源码 `packages/napcat-shell-loader/LINUX.md`，或 Shell 构建包中的 `LINUX.md`。

## 分支、发行和许可

所有修改在独立分支以中文分类标题提交并创建 PR。合入 `main` 需仓库所有者对本次合并的明确授权，禁止强推或绕过保护。GitHub Actions 只执行授权的发行构建、打包和提交元数据检查；测试与 QQ 运行始终限定在指定远端隔离服务器。

保留 NapCat 原始许可证、源码来源和组件许可。当前 Napi2Native 原生源码未恢复，接口初始化不能代替其源码审计或反检测验证。
