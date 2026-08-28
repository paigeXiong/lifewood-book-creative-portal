#!/usr/bin/env bash
set -Eeuo pipefail

archive="${1:-}"
[[ -n "$archive" && -f "$archive" ]] || { printf 'Usage: %s RELEASE.tar.gz\n' "$0" >&2; exit 2; }
command -v curl >/dev/null 2>&1 || { printf 'curl is required.\n' >&2; exit 2; }

temp_root="$(mktemp -d)"
api_pid=""
stop_api() {
  if [[ -n "$api_pid" ]] && kill -0 "$api_pid" 2>/dev/null; then
    kill -TERM "$api_pid" 2>/dev/null || true
    for _ in {1..20}; do
      if ! kill -0 "$api_pid" 2>/dev/null; then break; fi
      sleep 0.25
    done
    if kill -0 "$api_pid" 2>/dev/null; then kill -KILL "$api_pid" 2>/dev/null || true; fi
    wait "$api_pid" 2>/dev/null || true
  fi
  api_pid=""
}
cleanup() {
  stop_api
  rm -rf -- "$temp_root"
}
trap cleanup EXIT

tar -xzf "$archive" -C "$temp_root"
[[ -x "$temp_root/api/Lifewood.PlatformApi" ]] || { printf 'API executable is missing.\n' >&2; exit 1; }
[[ -f "$temp_root/web/customer/index.html" ]] || { printf 'Customer frontend is missing.\n' >&2; exit 1; }
[[ -f "$temp_root/web/admin/index.html" ]] || { printf 'Administrator frontend is missing.\n' >&2; exit 1; }
[[ -x "$temp_root/linux/install.sh" ]] || { printf 'Linux installer is missing or not executable.\n' >&2; exit 1; }
bash -n "$temp_root/linux/install.sh"
bash "$temp_root/linux/install.sh" --help >/dev/null

if find "$temp_root" -type f \( -name platform.db -o -name platform.lock -o -name 'audit-pending.*' \) -print -quit | grep -q .; then
  printf 'The release archive contains production data.\n' >&2
  exit 1
fi

port="${LIFEWOOD_SMOKE_PORT:-5089}"
mkdir -p -- "$temp_root/smoke-data"
ASPNETCORE_URLS="http://127.0.0.1:$port" \
Lifewood__DataDirectory="$temp_root/smoke-data" \
Lifewood__WebRoot="$temp_root/web" \
Lifewood__AllowInsecureHttp=true \
  "$temp_root/api/Lifewood.PlatformApi" >"$temp_root/api.log" 2>&1 &
api_pid="$!"

healthy=false
for _ in {1..30}; do
  if curl --fail --silent --max-time 2 "http://127.0.0.1:$port/api/health" >/dev/null; then
    healthy=true
    break
  fi
  if ! kill -0 "$api_pid" 2>/dev/null; then break; fi
  sleep 1
done

if ! $healthy; then
  cat "$temp_root/api.log" >&2
  printf 'Linux AOT service did not become healthy.\n' >&2
  exit 1
fi

curl --fail --silent --max-time 2 "http://127.0.0.1:$port/zh-CN/tasks" >/dev/null
curl --fail --silent --max-time 2 "http://127.0.0.1:$port/admin/zh-CN/overview" >/dev/null
stop_api

[[ -f "$temp_root/smoke-data/platform.db" ]] || { printf 'Smoke run did not create the platform database.\n' >&2; exit 1; }
printf 'Linux release smoke test passed.\n'
