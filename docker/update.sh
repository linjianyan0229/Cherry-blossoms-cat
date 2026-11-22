#!/usr/bin/env bash
set -euo pipefail

deploy_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
command -v docker >/dev/null || { printf '%s\n' '需要 Docker Engine 和 Docker Compose v2。' >&2; exit 1; }
[[ -f "$deploy_dir/.env" ]] || { printf '%s\n' '缺少 .env；请先设置目标发行镜像和 QQ 版本。' >&2; exit 1; }
project_name=$(sed -nE 's/^COMPOSE_PROJECT_NAME=([a-z0-9][a-z0-9_-]*)[[:space:]]*$/\1/p' "$deploy_dir/.env")
[[ "$project_name" =~ ^[a-z0-9][a-z0-9_-]*$ ]] \
  || { printf '%s\n' '.env 必须包含唯一的 COMPOSE_PROJECT_NAME=小写项目名称（无需引号）。' >&2; exit 1; }

# Caller exports must not redirect this updater into another Compose project or
# override the image/client selection recorded in this deployment's .env.
unset CHERRY_IMAGE CHERRY_QQ_VERSION CHERRY_WEBUI_PORT COMPOSE_PROJECT_NAME
cd -- "$deploy_dir"
compose=(docker compose --project-directory "$deploy_dir" --env-file "$deploy_dir/.env" \
  --project-name "$project_name" -f "$deploy_dir/compose.yml")

# This script updates only the service in this deployment directory. It does not
# remove volumes, attach a Docker socket to containers, or alter other projects.
"${compose[@]}" pull cherry
"${compose[@]}" up -d --no-deps cherry
