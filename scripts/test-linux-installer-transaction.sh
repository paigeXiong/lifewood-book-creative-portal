#!/usr/bin/env bash
set -Eeuo pipefail

[[ "${EUID:-$(id -u)}" -eq 0 ]] || { printf 'Run this CI integration test as root.\n' >&2; exit 2; }
[[ "${CI:-}" == true && "${LIFEWOOD_ALLOW_DESTRUCTIVE_INSTALLER_TEST:-}" == 1 ]] || {
  printf 'This destructive installer test is restricted to an explicitly enabled CI runner.\n' >&2
  exit 2
}

service_name="lifewood-book-portal"
service_user="lifewood-portal"
install_dir="/opt/lifewood-book-portal"
config_dir="/etc/lifewood-book-portal"
unit_file="/etc/systemd/system/$service_name.service"
configure_command="/usr/local/sbin/lifewood-portal-configure"

for target in "$install_dir" "$config_dir" "$unit_file" "$configure_command"; do
  [[ ! -e "$target" ]] || { printf 'Refusing to run over an existing installation: %s\n' "$target" >&2; exit 2; }
done
! id "$service_user" >/dev/null 2>&1 || { printf 'Refusing to reuse an existing service account.\n' >&2; exit 2; }
! getent group "$service_user" >/dev/null 2>&1 || { printf 'Refusing to reuse an existing service group.\n' >&2; exit 2; }

repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
test_root="$(mktemp -d /tmp/lifewood-installer-transaction.XXXXXX)"
payload_root="$test_root/payload"
fake_bin="$test_root/bin"
state_dir="$test_root/systemctl-state"
data_dir="/var/lib/lifewood-installer-transaction.$(basename -- "$test_root")"
output_log="$test_root/installer.log"

cleanup() {
  set +e
  case "$data_dir" in /var/lib/lifewood-installer-transaction.*) rm -rf -- "$data_dir" ;; esac
  rm -rf -- "$install_dir" "$config_dir"
  rm -f -- "$unit_file" "$configure_command"
  id "$service_user" >/dev/null 2>&1 && userdel "$service_user"
  getent group "$service_user" >/dev/null 2>&1 && groupdel "$service_user"
  rm -rf -- "$test_root"
}
trap cleanup EXIT

install -d "$payload_root/linux" "$payload_root/server/web/customer" "$payload_root/server/web/admin" "$fake_bin" "$state_dir"
printf 'inactive\n' > "$state_dir/active"
printf 'disabled\n' > "$state_dir/enabled"
printf '0\n' > "$state_dir/restart-count"
install -m 0755 "$repository_root/linux/install.sh" "$payload_root/linux/install.sh"
install -m 0644 "$repository_root/linux/lifewood-book-portal.service" "$payload_root/linux/lifewood-book-portal.service"
printf '#!/usr/bin/env sh\nexit 0\n' > "$payload_root/server/Lifewood.BookPortal.Server"
chmod 0755 "$payload_root/server/Lifewood.BookPortal.Server"
printf '<!doctype html><title>customer</title>\n' > "$payload_root/server/web/customer/index.html"
printf '<!doctype html><title>admin</title>\n' > "$payload_root/server/web/admin/index.html"

cat > "$fake_bin/systemctl" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
state_dir="$FAKE_SYSTEMCTL_STATE_DIR"
case "$1" in
  show)
    case "$*" in
      *LoadState*) printf '%s\n' "${FAKE_SYSTEMCTL_LOAD_STATE:-not-found}" ;;
      *ActiveState*) cat "$state_dir/active" ;;
      *UnitFileState*) cat "$state_dir/enabled" ;;
      *MainPID*) printf '4242\n' ;;
    esac
    ;;
  stop)
    printf 'inactive\n' > "$state_dir/active"
    ;;
  enable)
    printf 'enabled\n' > "$state_dir/enabled"
    ;;
  disable)
    printf 'disabled\n' > "$state_dir/enabled"
    ;;
  restart)
    runuser -u lifewood-portal -- touch "$FAKE_INSTALLER_DATA_DIR/platform.db"
    restart_count="$(cat "$state_dir/restart-count")"
    restart_count="$((restart_count + 1))"
    printf '%s\n' "$restart_count" > "$state_dir/restart-count"
    if [[ "${FAKE_SYSTEMCTL_RESTART_MODE:-failure}" == failure ||
          ( "${FAKE_SYSTEMCTL_RESTART_MODE:-failure}" == fail-once && "$restart_count" -eq 1 ) ]]; then
      printf 'failed\n' > "$state_dir/active"
      exit 1
    fi
    printf 'active\n' > "$state_dir/active"
    ;;
  is-active)
    [[ "$(cat "$state_dir/active")" == active ]]
    ;;
  is-enabled)
    [[ "$(cat "$state_dir/enabled")" == enabled ]]
    ;;
  *) exit 0 ;;
esac
EOF
chmod 0755 "$fake_bin/systemctl"

cat > "$fake_bin/curl" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  */api/health*) printf '{"status":"ok"}\n'; exit 0 ;;
  *) exit 1 ;;
esac
EOF
chmod 0755 "$fake_bin/curl"

test_path="$fake_bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
if env PATH="$test_path" FAKE_INSTALLER_DATA_DIR="$data_dir" FAKE_SYSTEMCTL_STATE_DIR="$state_dir" FAKE_SYSTEMCTL_RESTART_MODE=failure \
  bash "$payload_root/linux/install.sh" --non-interactive --lang en-US --port 65432 --data-dir "$data_dir" --trusted-proxy '' >"$output_log" 2>&1; then
  printf 'Expected the simulated first startup to fail.\n' >&2
  exit 1
fi

[[ -f "$data_dir/platform.db" ]] || { printf 'Failed first startup did not preserve its database.\n' >&2; exit 1; }
[[ -f "$config_dir/portal.env" ]] || { printf 'Failed first startup lost its data-directory record.\n' >&2; exit 1; }
grep -Fqx "Lifewood__DataDirectory=$data_dir" "$config_dir/portal.env"
grep -Fq "preserving its data-directory record" "$output_log"
[[ ! -e "$install_dir" && ! -e "$unit_file" && ! -e "$configure_command" ]] || {
  printf 'Failed first startup did not roll back installed program files.\n' >&2
  exit 1
}

printf '0\n' > "$state_dir/restart-count"
env PATH="$test_path" FAKE_INSTALLER_DATA_DIR="$data_dir" FAKE_SYSTEMCTL_STATE_DIR="$state_dir" FAKE_SYSTEMCTL_RESTART_MODE=success \
  bash "$payload_root/linux/install.sh" --non-interactive --lang en-US --port 65432 --trusted-proxy '' >"$output_log" 2>&1

[[ -x "$install_dir/server/Lifewood.BookPortal.Server" ]] || { printf 'Retry did not install the server.\n' >&2; exit 1; }
[[ -f "$unit_file" && -x "$configure_command" ]] || { printf 'Retry did not install service management files.\n' >&2; exit 1; }
grep -Fqx "Lifewood__DataDirectory=$data_dir" "$config_dir/portal.env"
[[ -f "$data_dir/platform.db" ]] || { printf 'Retry did not retain the first-start database.\n' >&2; exit 1; }

snapshot_dir="$test_root/snapshot"
install -d "$snapshot_dir"
cp -a "$install_dir/server/Lifewood.BookPortal.Server" "$snapshot_dir/server"
cp -a "$config_dir/portal.env" "$snapshot_dir/portal.env"
cp -a "$unit_file" "$snapshot_dir/service"
cp -a "$configure_command" "$snapshot_dir/configure"

printf '#!/usr/bin/env sh\nexit 2\n' > "$payload_root/server/Lifewood.BookPortal.Server"
chmod 0755 "$payload_root/server/Lifewood.BookPortal.Server"
printf '0\n' > "$state_dir/restart-count"
if env PATH="$test_path" FAKE_INSTALLER_DATA_DIR="$data_dir" FAKE_SYSTEMCTL_STATE_DIR="$state_dir" \
  FAKE_SYSTEMCTL_LOAD_STATE=loaded FAKE_SYSTEMCTL_RESTART_MODE=fail-once \
  bash "$payload_root/linux/install.sh" --non-interactive --lang en-US --port 65433 --trusted-proxy '' >"$output_log" 2>&1; then
  printf 'Expected the simulated upgrade startup to fail.\n' >&2
  exit 1
fi

cmp -s "$snapshot_dir/server" "$install_dir/server/Lifewood.BookPortal.Server"
cmp -s "$snapshot_dir/portal.env" "$config_dir/portal.env"
cmp -s "$snapshot_dir/service" "$unit_file"
cmp -s "$snapshot_dir/configure" "$configure_command"
[[ "$(cat "$state_dir/active")" == active && "$(cat "$state_dir/enabled")" == enabled ]] || {
  printf 'Failed upgrade did not restore active and enabled service state.\n' >&2
  exit 1
}

printf '0\n' > "$state_dir/restart-count"
if env PATH="$test_path" FAKE_INSTALLER_DATA_DIR="$data_dir" FAKE_SYSTEMCTL_STATE_DIR="$state_dir" \
  FAKE_SYSTEMCTL_LOAD_STATE=loaded FAKE_SYSTEMCTL_RESTART_MODE=fail-once \
  bash "$configure_command" --non-interactive --lang en-US --port 65434 --trusted-proxy '' >"$output_log" 2>&1; then
  printf 'Expected the simulated configuration restart to fail.\n' >&2
  exit 1
fi

cmp -s "$snapshot_dir/server" "$install_dir/server/Lifewood.BookPortal.Server"
cmp -s "$snapshot_dir/portal.env" "$config_dir/portal.env"
cmp -s "$snapshot_dir/service" "$unit_file"
cmp -s "$snapshot_dir/configure" "$configure_command"
[[ "$(cat "$state_dir/active")" == active && "$(cat "$state_dir/enabled")" == enabled ]] || {
  printf 'Failed configuration did not restore active and enabled service state.\n' >&2
  exit 1
}

printf 'Linux installer transaction test passed.\n'
