# Linux QQ 客户端来源

此 **0.0.1 公开** Docker 镜像包含完整解包的 Linux QQ **3.2.34-53644 amd64**。QQ 为腾讯提供的客户端，其版权、商标和使用条款仍属于相应权利人；本项目维护授权不等于 QQ 客户端的授权。使用者应遵守 QQ 客户端安装包中的条款。

- 原始安装包：`QQ_3.2.34_260924_amd64_01.deb`
- 下载来源：https://qqdl.gtimg.cn/qqfile/QQNT/9.9.36/beta/9ee04bef/linuxqq_3.2.34-53644_amd64.deb
- 官方版本来源：https://qqdl.gtimg.cn/qqfile/QQNTV2/9.9.36/release/9ee04bef/QQ_3.2.34_260924_amd64_01.deb
- 文件字节数：`187185496`
- SHA-256：`436c65e1dd28422e128a21cbddb5fe4e2e6c079d7f27fec2541e014d38cc336e`
- 项目记录：`compatibility/linux-qq.json`；验证级别为 `login-verified`。

指定远端隔离实例已完成扫码登录和核心在线验证。尚未验证主动发送消息、长期推送和反检测效果。

镜像在 `/opt/qq-distribution` 保留 DEB 的完整文件载荷，包括安装树、说明与版权材料。构建只使用 `dpkg-deb --extract`，不执行安装脚本，不启动客户端。`/opt/QQ` 指向其中的原始安装树；实际运行时由 Linux 启动器在专用工作卷中复制完整运行副本，原始树保持只读。

上述 SHA-256 用于核对项目所记录的文件内容，不是腾讯的数字签名或认证。工作流核对验证标记及完整安装包身份；登录和消息读取证据不代表消息发送、长期稳定性或反检测验证。
