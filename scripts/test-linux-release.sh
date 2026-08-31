#!/usr/bin/env bash
set -Eeuo pipefail

archive="${1:-}"
[[ -n "$archive" && -f "$archive" ]] || { printf 'Usage: %s RELEASE.tar.gz\n' "$0" >&2; exit 2; }
command -v curl >/dev/null 2>&1 || { printf 'curl is required.\n' >&2; exit 2; }

temp_root="$(mktemp -d)"
server_pid=""
stop_server() {
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null; then
    kill -TERM "$server_pid" 2>/dev/null || true
    for _ in {1..20}; do
      if ! kill -0 "$server_pid" 2>/dev/null; then break; fi
      sleep 0.25
    done
    if kill -0 "$server_pid" 2>/dev/null; then kill -KILL "$server_pid" 2>/dev/null || true; fi
    wait "$server_pid" 2>/dev/null || true
  fi
  server_pid=""
}
cleanup() {
  stop_server
  rm -rf -- "$temp_root"
}
trap cleanup EXIT

tar -xzf "$archive" -C "$temp_root"
[[ -x "$temp_root/server/Lifewood.BookPortal.Server" ]] || { printf 'Server executable is missing.\n' >&2; exit 1; }
[[ -f "$temp_root/server/web/customer/index.html" ]] || { printf 'Customer frontend is missing.\n' >&2; exit 1; }
[[ -f "$temp_root/server/web/admin/index.html" ]] || { printf 'Administrator frontend is missing.\n' >&2; exit 1; }
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
Lifewood__WebRoot="$temp_root/server/web" \
  "$temp_root/server/Lifewood.BookPortal.Server" >"$temp_root/server.log" 2>&1 &
server_pid="$!"

healthy=false
for _ in {1..30}; do
  if curl --fail --silent --max-time 2 "http://127.0.0.1:$port/api/health" >/dev/null; then
    healthy=true
    break
  fi
  if ! kill -0 "$server_pid" 2>/dev/null; then break; fi
  sleep 1
done

if ! $healthy; then
  cat "$temp_root/server.log" >&2
  printf 'Linux AOT service did not become healthy.\n' >&2
  exit 1
fi

curl --fail --silent --max-time 2 "http://127.0.0.1:$port/zh-CN/tasks" >/dev/null
curl --fail --silent --max-time 2 "http://127.0.0.1:$port/admin/zh-CN/overview" >/dev/null
cookie_jar="$temp_root/cookies.txt"
csrf_payload="$(curl --fail --silent --max-time 2 -c "$cookie_jar" "http://127.0.0.1:$port/api/auth/csrf")"
csrf_token="$(printf '%s' "$csrf_payload" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
[[ -n "$csrf_token" ]] || { printf 'Production loopback CSRF token is missing.\n' >&2; exit 1; }
bootstrap_body='{"displayName":"Linux Smoke Owner","email":"linux-smoke@example.test","password":"linux-smoke-password-123"}'
curl --fail --silent --max-time 5 -b "$cookie_jar" -c "$cookie_jar" \
  -H "X-CSRF-TOKEN: $csrf_token" -H 'Content-Type: application/json' \
  --data "$bootstrap_body" "http://127.0.0.1:$port/api/auth/bootstrap" >/dev/null
curl --fail --silent --max-time 2 -b "$cookie_jar" "http://127.0.0.1:$port/api/me" | grep -q 'linux-smoke@example.test'
stop_server

[[ -f "$temp_root/smoke-data/platform.db" ]] || { printf 'Smoke run did not create the platform database.\n' >&2; exit 1; }
printf 'Linux release smoke test passed.\n'
