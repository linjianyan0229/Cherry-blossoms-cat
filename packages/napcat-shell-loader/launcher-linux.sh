#!/usr/bin/env bash
set -euo pipefail
umask 077

launcher_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
shell_dir=$launcher_dir
workdir=${NAPCAT_WORKDIR:-${XDG_DATA_HOME:-$HOME/.local/share}/Cherry-blossoms-cat}
qq_data_dir=${NAPCAT_QQ_DATA_DIR:-}
qq_dir=
display_mode=auto
no_sandbox=0
prepare_only=0
restore=0

usage() {
  cat <<'USAGE'
用法：bash launcher-linux.sh --qq QQ安装目录 [选项]
  --shell 目录          Shell 发行目录，默认是启动器所在目录
  --workdir 目录        配置和专用 QQ 运行副本目录
  --qq-data-dir 目录    QQ 数据目录，默认 WORKDIR/qq-data
  --display 模式        auto、system 或 xvfb，默认 auto
  --no-sandbox          显式关闭 Chromium 沙箱
  --prepare-only        仅准备文件，不启动 QQ 或 Shell
  --restore             仅恢复专用副本的原始入口，不需要 --qq
  --help                显示帮助
USAGE
}

fail() { printf '%s\n' "$*" >&2; exit 1; }
value() { [[ $# -ge 2 && -n $2 ]] || fail "选项缺少值：$1"; }

while (($#)); do
  case $1 in
    --qq) value "$@"; qq_dir=$2; shift 2 ;;
    --shell) value "$@"; shell_dir=$2; shift 2 ;;
    --workdir) value "$@"; workdir=$2; shift 2 ;;
    --qq-data-dir) value "$@"; qq_data_dir=$2; shift 2 ;;
    --display) value "$@"; display_mode=$2; shift 2 ;;
    --no-sandbox) no_sandbox=1; shift ;;
    --prepare-only) prepare_only=1; shift ;;
    --restore) restore=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) fail "未知选项：$1" ;;
  esac
done
case $display_mode in auto|system|xvfb) ;; *) fail '显示模式必须是 auto、system 或 xvfb' ;; esac
[[ $(uname -s) == Linux ]] || fail '此启动器仅用于 Linux'
command -v node >/dev/null || fail '需要系统 Node.js 20 或更新版本，仅用于文件准备'
command -v flock >/dev/null || fail '需要 flock（util-linux），用于锁定专用运行目录'
[[ $restore == 0 || $prepare_only == 0 ]] || fail '--restore 与 --prepare-only 不能同时使用'

helper=$launcher_dir/linux-prepare.cjs
if [[ $restore == 1 ]]; then
  workdir=$(node "$helper" root --workdir "$workdir")
else
  [[ -n $qq_dir ]] || fail '请用 --qq 指定包含 qq 和 resources/app 的 QQ 安装目录'
  args=(--qq "$qq_dir" --shell "$shell_dir" --workdir "$workdir")
  [[ -z $qq_data_dir ]] || args+=(--qq-data-dir "$qq_data_dir")
  workdir=$(node "$helper" root "${args[@]}")
fi

exec 9>"$workdir/.linux-launcher.lock"
flock -n 9 || fail '该工作目录正在准备或运行 QQ；请先结束对应启动器进程'
if [[ $restore == 1 ]]; then
  node "$helper" restore --workdir "$workdir"
  exit 0
fi

shell_dir=$(cd -- "$shell_dir" && pwd -P)
args=(--qq "$qq_dir" --shell "$shell_dir" --workdir "$workdir")
[[ -z $qq_data_dir ]] || args+=(--qq-data-dir "$qq_data_dir")
qq_data_dir=$(node "$helper" prepare "${args[@]}")
if [[ $prepare_only == 1 ]]; then
  printf '仅完成文件准备，未启动 QQ。运行副本：%s\n' "$workdir/linux-qq-runtime/qq"
  exit 0
fi

runtime=$workdir/linux-qq-runtime
export NAPCAT_WORKDIR=$workdir NAPCAT_QQ_DATA_DIR=$qq_data_dir
export NAPCAT_MAIN_PATH=$shell_dir/napcat.mjs
export NAPCAT_LINUX_RUNTIME=$runtime
export NAPCAT_WRAPPER_PATH=$runtime/qq/resources/app/wrapper.node
export NAPCAT_QQ_PACKAGE_INFO_PATH=$runtime/qq/resources/app/package.json
export NAPCAT_QQ_VERSION_CONFIG_PATH=$runtime/qq-version.json
export NAPCAT_DISABLE_MULTI_PROCESS=1 NAPCAT_DISABLE_PIPE=1
unset ELECTRON_RUN_AS_NODE NAPCAT_FORCE_NODE_PROCESS NAPCAT_WORKER_PROCESS NAPCAT_PRELOAD_NODE_ADDON_PATH

qq_args=("$runtime/qq/qq" --disable-gpu)
[[ $no_sandbox == 0 ]] || qq_args+=(--no-sandbox)
if [[ $display_mode == auto ]]; then
  if [[ -n ${DISPLAY:-} ]]; then display_mode=system; else display_mode=xvfb; fi
fi
if [[ $display_mode == system ]]; then
  [[ -n ${DISPLAY:-} ]] || fail 'system 模式需要可用的 DISPLAY；也可选择 --display xvfb'
  exec "${qq_args[@]}"
fi
command -v xvfb-run >/dev/null || fail '无显示环境，需要 xvfb-run；也可设置 DISPLAY 使用 --display system'
command -v xauth >/dev/null || fail 'Xvfb 模式需要 xauth'
exec xvfb-run -a "${qq_args[@]}"
