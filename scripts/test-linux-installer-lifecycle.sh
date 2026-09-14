#!/usr/bin/env bash
set -Eeuo pipefail

# This installs a real systemd service. Never run on a workstation or production host.
[[ "${EUID:-$(id -u)}" == 0 && "${CI:-}" == true && "${GITHUB_ACTIONS:-}" == true &&
   "${RUNNER_ENVIRONMENT:-}" == github-hosted && "${LIFEWOOD_ALLOW_DESTRUCTIVE_INSTALLER_TEST:-}" == 1 ]] || {
  printf 'This test requires an explicitly enabled, disposable GitHub-hosted root session.\n' >&2; exit 2;
}
[[ "$(uname -s)" == Linux && "$(cat /proc/1/comm)" == systemd ]] || { printf 'Real Linux systemd is required.\n' >&2; exit 2; }
repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
archive="$(realpath -e -- "${1:?Expected a locally built release archive}")"
node_bin="$(realpath -e -- "${2:?Expected the setup-node executable}")"
case "$archive" in "$repository_root"/artifacts/release/*.tar.gz) ;; *) exit 2 ;; esac
service=lifewood-book-portal.service
service_user=lifewood-portal
install_dir=/opt/lifewood-book-portal
config_dir=/etc/lifewood-book-portal
unit_file=/etc/systemd/system/lifewood-book-portal.service
configure_command=/usr/local/sbin/lifewood-portal-configure
coordination_dir=/var/lib/lifewood-book-portal-coordination
for target in "$install_dir" "$config_dir" "$unit_file" "$configure_command" "$coordination_dir" /var/lib/lifewood-book-portal; do
  [[ ! -e "$target" && ! -L "$target" ]] || { printf 'Existing installation path: %s\n' "$target" >&2; exit 2; }
done
[[ "$(systemctl show "$service" --property=LoadState --value)" == not-found ]] || exit 2
! id "$service_user" >/dev/null 2>&1 || exit 2
! getent group "$service_user" >/dev/null 2>&1 || exit 2
"$node_bin" --input-type=module -e 'import net from "node:net"; const s=net.createServer(); s.on("error",()=>process.exit(2)); s.listen(5098,"127.0.0.1",()=>s.close());'

test_root="$(mktemp -d /var/lib/lifewood-lifecycle.XXXXXX)"
# Installer requires root-owned, non-writable ancestors; service needs traversal.
chmod 0755 "$test_root"
data_dir="$test_root/data"
mkdir -p "$repository_root/artifacts/installer-lifecycle"
report_dir="$(mktemp -d "$repository_root/artifacts/installer-lifecycle/linux.XXXXXX")"
state_file="$report_dir/private-state.json"
payload="$test_root/payload"
mkdir "$payload"
tar -xzf "$archive" -C "$payload" --no-same-owner
cleanup() {
  local status=$?
  set +e
  systemctl disable --now "$service" >/dev/null 2>&1
  # Only these paths, proven absent before this disposable test, belong to us.
  rm -f -- "$unit_file" "$configure_command"
  rm -rf -- "$install_dir" "$config_dir" "$coordination_dir"
  systemctl daemon-reload
  systemctl reset-failed "$service" >/dev/null 2>&1
  id "$service_user" >/dev/null 2>&1 && userdel "$service_user"
  getent group "$service_user" >/dev/null 2>&1 && groupdel "$service_user"
  case "$test_root" in /var/lib/lifewood-lifecycle.*) rm -rf -- "$test_root" ;; esac
  return "$status"
}
trap cleanup EXIT
fixture() {
  LIFEWOOD_INSTALLER_FIXTURE=1 "$node_bin" "$repository_root/scripts/installer-fixture.mjs" "$1" http://127.0.0.1:5098 "$state_file"
}
assert_service() {
  systemctl is-active --quiet "$service"
  systemctl is-enabled --quiet "$service"
  [[ "$(systemctl show "$service" --property=User --value)" == "$service_user" ]]
  local pid
  pid="$(systemctl show "$service" --property=MainPID --value)"
  [[ "$pid" =~ ^[1-9][0-9]*$ && "$(stat -c '%U' "/proc/$pid")" == "$service_user" ]]
  [[ "$(readlink -f "/proc/$pid/exe")" == "$install_dir/server/Lifewood.BookPortal.Server" ]]
  grep -Fqx "Lifewood__DataDirectory=$data_dir" "$config_dir/portal.env"
  grep -Fqx 'ASPNETCORE_URLS=http://127.0.0.1:5098' "$config_dir/portal.env"
  curl --fail --silent --max-time 5 http://127.0.0.1:5098/api/health | grep -Fq '"status":"ok"'
}

printf 'First installation / 首次安装\n'
bash "$payload/linux/install.sh" --non-interactive --lang zh-CN --port 5098 --data-dir "$data_dir" --trusted-proxy ''
assert_service
fixture seed
fixture verify

printf 'Overwrite installation / 覆盖安装\n'
# Linux rejects a changed data path rather than silently ignoring it.
sha256sum "$install_dir/server/Lifewood.BookPortal.Server" "$config_dir/portal.env" "$unit_file" "$configure_command" > "$report_dir/rejection.sha256"
if bash "$payload/linux/install.sh" --non-interactive --lang en-US --data-dir "$test_root/forbidden-data" > "$report_dir/rejected-path.log" 2>&1; then
  printf 'Changed data path unexpectedly accepted.\n' >&2; exit 1
fi
grep -Fq 'The production data directory is locked' "$report_dir/rejected-path.log"
[[ ! -e "$test_root/forbidden-data" && ! -e "$test_root/forbidden-data.backups" ]]
sha256sum --check --status "$report_dir/rejection.sha256"
assert_service
fixture verify
# Same release: verifies installer replacement, not historical database migration.
bash "$payload/linux/install.sh" --non-interactive --lang en-US
assert_service
fixture verify

printf 'Failed startup rollback / 启动失败回滚\n'
sha256sum "$install_dir/server/Lifewood.BookPortal.Server" "$config_dir/portal.env" "$unit_file" "$configure_command" > "$report_dir/before.sha256"
# Corrupt only the disposable candidate executable. The old program must return.
printf '#!/bin/sh\nexit 42\n' > "$payload/server/Lifewood.BookPortal.Server"
chmod 0755 "$payload/server/Lifewood.BookPortal.Server"
if bash "$payload/linux/install.sh" --non-interactive --lang zh-CN --port 5099 > "$report_dir/failed-install.log" 2>&1; then
  printf 'Broken candidate unexpectedly installed.\n' >&2; exit 1
fi
grep -Fq '服务启动失败' "$report_dir/failed-install.log"
sha256sum --check --status "$report_dir/before.sha256"
assert_service
fixture verify

printf 'Healthy retry / 回滚后重试\n'
tar -xzf "$archive" -C "$payload" --no-same-owner
bash "$payload/linux/install.sh" --non-interactive --lang en-US
assert_service
fixture verify

report='Real systemd lifecycle passed: Chinese installation, English overwrite with locked data path, failed candidate rollback, healthy retry; project/file/delivery/feedback/notification/backup fixtures preserved. Same-release replacement only; historical database migration is not covered.'
printf '%s\n' "$report"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf '### Linux 安装演练 / Linux installer lifecycle\n\n%s\n' "$report" >> "$GITHUB_STEP_SUMMARY"
fi
