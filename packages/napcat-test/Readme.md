# NapCat-Test

## 测试方向

测试过程不涉及账号登录

## 可选环境用例

所有安装和执行操作均须遵守仓库根目录的 `TESTING.md`，在指定远端服务器的专用隔离容器中进行。

### 实际 ZIP 归档

`projectUpdate.test.ts` 使用 `PATH` 中的 `zip` 命令生成发行 runner 的实际 `zip -q -r archive .` 布局。准备 Info-ZIP 后执行以下命令，确认该用例通过。

```sh
pnpm --filter napcat-test test --run projectUpdate.test.ts
```

### QQ 原生参数转换

`groupAlbumCommentNative.test.ts` 的原生用例需要公开 QQ 安装包中的 `wrapper.node`。使用 QQ 定制运行时的 Linux 版本还需提供同一安装目录中的 QQ 可执行文件，并在容器中准备 `xvfb-run` 及 QQ 的系统依赖。

```sh
export NAPCAT_TEST_QQ_WRAPPER=/opt/QQ/resources/app/wrapper.node
export NAPCAT_TEST_QQ_EXECUTABLE=/opt/QQ/qq
pnpm --filter napcat-test test --run groupAlbumCommentNative.test.ts
```

探针在临时目录中复制 QQ 可执行文件和应用入口，通过只读资源启动 QQ 自带的 Electron/Node。独立的 HOME、XDG 目录用于此次运行，探针结束后删除临时目录。容器应使用测试资源并断开外部网络。

断言覆盖缺失 `like` 字段时的原生转换错误，以及完整六参数转换后到达未绑定服务检查。测试限定于未绑定的 `NodeIKernelAlbumService` 参数转换，成功标记仅在两条原生断言均通过后输出。

对于能够直接加载目标模块的 Node 运行时，可仅设置 `NAPCAT_TEST_QQ_WRAPPER`。QQ 定制模块可能依赖普通 Node 未导出的符号，此时应设置上述 QQ 可执行文件路径。

### Windows 批处理启动器

`loaderPaths.test.ts` 的批处理用例由 Windows 版 Node 执行时启用，使用 `cmd.exe` 调用实际 `napcat.bat`，验证含中文、空格、`#`、`%` 的目录、参数传递和退出码。

```sh
pnpm --filter napcat-test test --run loaderPaths.test.ts
```

在指定 Linux 测试服务器使用 Wine 时，需运行官方 Windows Node，并明确记录 Wine 版本、Node 版本和测试结果。该结果属于 Wine 兼容环境验证，原生 Windows 验证仍需指定服务器具备相应的隔离运行环境。
