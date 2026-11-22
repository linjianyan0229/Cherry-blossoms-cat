# Linux QQ 版本维护

当前维护优先跟进 Linux QQ x64。项目发行版本、QQ 完整版本、QQ Build、平台和架构分别记录；其他架构须独立验证后才提升支持级别。源码基线与许可见 [MAINTAINING.md](MAINTAINING.md)。

## 官方版本来源

官网使用两个公开配置地址：

- [官网代理](https://im.qq.com/proxy/domain/qq-web.cdn-go.cn/im.qq.com_new/latest/rainbow/pcConfig.json)。
- [CDN 直连](https://qq-web.cdn-go.cn/im.qq.com_new/latest/rainbow/pcConfig.json)。

2026-11-22 核对时，官网代理返回 Linux **3.2.35 / 2026-11-03**，CDN 仍返回 **3.2.34 / 2026-09-24**。检查器读取两个来源，比较版本与日期并报告不同步。网页 `Linux.version` 不含 Build；完整版本须取自 DEB 控制 `Version` 或包内 `resources/app/package.json`。MIPS 等架构可能仍指向旧包，不能套用顶层 Linux 版本。

新 Linux x64 包已读取为 **3.2.35-54395**。2026-11-22 在指定服务器复核时，官网配置的 `/QQNTV2/` 路径返回 403，将目录改为 `/qqntv2/` 后腾讯下载服务器返回 200，实际分段下载返回正确的 206。完整官方下载包为 188287504 字节，SHA256 为 `7de03862327abbd16da27130413698c9517782b27194afc593bc3abf9b55f9ac`，与此前临时镜像副本一致。此哈希来自实际文件校验，腾讯未另行提供签名。原始配置地址、可用下载地址和校验信息分别保存在维护清单。

Shell/Framework ZIP 不携带 QQ 本体；Docker 发行镜像使用单独锁定、核验大小和 SHA256 的官方 QQ 安装树，保留完整版权材料。镜像默认版本与更新方式见 [DOCKER.md](DOCKER.md)。

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

## 3.2.35-54395 x64 原生入口

本轮补齐两个偏移表，原生模块未替换。当前 MoeHoo 的 `initHook` 将十六进制参数右移一位，再加 `wrapper.node` 的加载基址；其表项为实际 RVA 的两倍。Napi2Native 使用普通 RVA。第四个 `o3HookMode` 参数不参与地址解析。

| 入口 | 54395 实际 RVA | 偏移表值 |
| --- | --- | --- |
| MoeHoo send | `665CC80` | `CCB9900` |
| MoeHoo recv | `665EA20` | `CCBD440` |
| Napi2Native send | `6EBE4D0` | `6EBE4D0` |
| Napi2Native recv | `3A49520` | `3A49520` |

四个入口都核对了旧、新版本的完整函数指令、展开表函数边界和语义引用；Napi recv 的 108 个模板前缀候选经过完整函数匹配后只剩一项。可复核摘要见 [原生入口证据](compatibility/evidence/linux-qq-54395-native.json)。

源码中的 `scripts/review-linux-native-offsets.cjs` 只读取 ELF 和调用 `objdump` 反汇编，不加载原生模块。它以 53644 的四个入口为比较基线，须在指定远端隔离容器中提供该版本和 54395 的 wrapper 文件；未配置 `CHERRY_NATIVE_OBJDUMP` 时使用容器里的 `objdump`：

```bash
node scripts/review-linux-native-offsets.cjs /fixtures/53644/wrapper.node \
  /fixtures/54395/wrapper.node --functions > /scratch/native-functions.json
```

结果包含全部前缀候选及完整函数的 `exactNormalizedMatch`。该脚本提供版本间的静态对应证据；采用新版本偏移仍须经过真实 Hook 初始化和回调验证。

指定远端的新隔离实例中，正常首次加载的 MoeHoo 返回 `success`，实际捕获双向 `Heartbeat.Alive`、`Client.CorrectTime` 和 `wtlogin.trans_emp` 回调。QQ 引擎就绪后，用首次加载保留的 Napi2Native exports 初始化返回 `true`，MoeHoo 回调继续正常。新 QQ 尚未扫码登录，用户消息与 Buffer 发包的完整响应链仍未验证，反检测效果也未证明。

诊断工具须沿用项目的初始化顺序：MoeHoo 不得重复 `process.dlopen`，Napi Hook 必须在 `wrapper.node` 加载完成后安装。原生模块没有保护零基址，提前安装会把裸 RVA 交给 Hook 引擎并触发崩溃。项目现有 Napi 初始化发生在登录后的发包客户端初始化阶段；本轮没有提前移动该调用。Docker 预览包使用 54395，发行门禁要求保留预发布版本后缀，并记录以上验证范围。

## 分支、发行和许可

所有修改在独立分支以中文分类标题提交并创建 PR。合入 `main` 需仓库所有者对本次合并的明确授权，禁止强推或绕过保护。GitHub Actions 只执行授权的发行构建、打包和提交元数据检查；测试与 QQ 运行始终限定在指定远端隔离服务器。

保留 NapCat 原始许可证、源码来源和组件许可。当前 Napi2Native 原生源码未恢复，接口初始化不能代替其源码审计或反检测验证。
