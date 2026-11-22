# Linux QQ 客户端来源

此 **0.0.2-rc.1 新 QQ 预览** Docker 镜像包含完整解包的 Linux QQ **3.2.35-54395 amd64**，用于个人内测维护。QQ 为腾讯提供的客户端，其版权、商标和使用条款仍属于相应权利人；本项目维护授权不等于 QQ 客户端的授权。使用者应遵守 QQ 客户端安装包中的条款。

- 原始安装包：`QQ_3.2.35_261103_amd64_01.deb`
- 来源：https://qqdl.gtimg.cn/qqfile/qqntv2/9.9.37/release/816b3c79/QQ_3.2.35_261103_amd64_01.deb
- 文件字节数：`188287504`
- SHA-256：`7de03862327abbd16da27130413698c9517782b27194afc593bc3abf9b55f9ac`
- 项目记录：`compatibility/linux-qq.json`；验证级别为 `login-verified`，原生 packet 双向回调为 `callback-verified`，napi Hook 初始化为 `init-verified`。

指定远端的新隔离实例已扫码登录；正常 engine 启动后 napi 首次初始化返回 `true`，同进程 packet 持续产生双向协议包回调。最近联系人、群历史及按 ID 读取消息成功，非敏感记录见 `compatibility/evidence/linux-qq-54395-login.json`。尚未验证主动发送消息、长期推送和反检测效果。QQ **3.2.34-53644** 仍保留为历史已登录验证基线，不由该预览自动替换。

镜像在 `/opt/qq-distribution` 保留 DEB 的完整文件载荷，包括安装树、说明与版权材料。构建只使用 `dpkg-deb --extract`，不执行安装脚本，不启动客户端。`/opt/QQ` 指向其中的原始安装树；实际运行时由 Linux 启动器在专用工作卷中复制完整运行副本，原始树保持只读。

上述 SHA-256 用于核对项目所记录的文件内容，不是腾讯的数字签名或认证。预览镜像只允许以预发布版本发行，工作流核对验证标记及完整安装包身份；登录和消息读取证据不代表消息发送、长期稳定性或反检测验证。
