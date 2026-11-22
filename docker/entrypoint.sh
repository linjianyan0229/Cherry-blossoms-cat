#!/usr/bin/env bash
set -euo pipefail
umask 077

fail() { printf '%s\n' "$*" >&2; exit 1; }
[[ $(id -u) == 1000 ]] || fail '镜像仅支持 UID 1000；请使用发行 Compose 的隔离设置。'
[[ -n ${IMAGE_QQ_VERSION:-} ]] || fail '镜像没有锁定的 QQ 版本元数据。'
actual_version=$(node -p "JSON.parse(require('node:fs').readFileSync('/opt/QQ/resources/app/package.json', 'utf8')).version")
[[ $actual_version == "$IMAGE_QQ_VERSION" ]] || fail '镜像 QQ 安装树与发行版本元数据不一致。'
[[ ${CHERRY_QQ_VERSION:-$IMAGE_QQ_VERSION} == "$IMAGE_QQ_VERSION" ]] \
  || fail 'CHERRY_QQ_VERSION 与镜像不一致；请先使用对应版本的 Compose/.env，避免复用旧 QQ 运行卷。'

# Additional options are deliberately limited to the file-only preparation mode.
if (($#)); then
  [[ $# == 1 && $1 == --prepare-only ]] || fail '只接受 --prepare-only；正常启动无需额外参数。'
fi
if [[ -d /opt/cherry/plugins/napcat-plugin-builtin \
      && ! -e /work/plugins/napcat-plugin-builtin \
      && ! -L /work/plugins/napcat-plugin-builtin ]]; then
  cp -R --no-preserve=ownership /opt/cherry/plugins/napcat-plugin-builtin /work/plugins/
fi
exec bash /opt/cherry/launcher-linux.sh \
  --qq /opt/QQ --workdir /work --qq-data-dir /data/qq-data \
  --display xvfb --no-sandbox "$@"
