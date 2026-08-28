#!/usr/bin/env bash
set -Eeuo pipefail

repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
installer="$repository_root/linux/install.sh"
temp_root="$(mktemp -d)"
recorded_data="$(sudo mktemp -d /var/lib/lifewood-installer-recorded.XXXXXX)"
cleanup() {
  case "$recorded_data" in
    /var/lib/lifewood-installer-recorded.*) sudo rm -rf -- "$recorded_data" ;;
    *) printf 'Refusing to remove unsafe test directory: %s\n' "$recorded_data" >&2 ;;
  esac
  rm -rf -- "$temp_root"
}
trap cleanup EXIT

expect_failure() {
  local label="$1"
  shift
  if "$@" >"$temp_root/output.log" 2>&1; then
    printf 'Expected failure: %s\n' "$label" >&2
    cat "$temp_root/output.log" >&2
    exit 1
  fi
}

bash "$installer" --validate-only --lang en-US --data-dir "/var/lib/lifewood-installer-validation-$$" --trusted-proxy 127.0.0.1 >/dev/null
bash "$installer" --validate-only --lang zh-CN --data-dir "/srv/lifewood-installer-validation-$$" --trusted-proxy ::1 >/dev/null
bash "$installer" --lang en-US --help | grep -Fq "Usage:"
bash "$installer" --help --lang zh-CN | grep -Fq "用法："
expect_failure "localized validation error" bash "$installer" --lang zh-CN --validate-only --port invalid --data-dir "/var/lib/lifewood-installer-validation-$$"
grep -Fq "错误：端口必须是数字" "$temp_root/output.log"

expect_failure "dot segments" bash "$installer" --validate-only --data-dir /var/lib/example/../portal
expect_failure "protected tree" bash "$installer" --validate-only --data-dir /etc/lifewood
expect_failure "shared mount root" bash "$installer" --validate-only --data-dir /mnt
expect_failure "malformed IPv4" bash "$installer" --validate-only --data-dir "/var/lib/lifewood-installer-validation-$$" --trusted-proxy 999.999.999.999
expect_failure "malformed IPv6" bash "$installer" --validate-only --data-dir "/var/lib/lifewood-installer-validation-$$" --trusted-proxy ::::
expect_failure "resolving hostname" bash "$installer" --validate-only --data-dir "/var/lib/lifewood-installer-validation-$$" --trusted-proxy abc.de

duplicate_env="$temp_root/duplicate.env"
cat > "$duplicate_env" <<EOF
ASPNETCORE_URLS=http://127.0.0.1:5077
Lifewood__DataDirectory=/var/lib/lifewood-a
Lifewood__DataDirectory=/var/lib/lifewood-b
EOF
expect_failure "duplicate managed key" env LIFEWOOD_INSTALLER_TEST_ENV_FILE="$duplicate_env" bash "$installer" --lang zh-CN --validate-only
grep -Fq "错误：配置包含重复字段 Lifewood__DataDirectory：$duplicate_env" "$temp_root/output.log"

unsafe_env="$temp_root/unsafe.env"
cat > "$unsafe_env" <<EOF
ASPNETCORE_URLS=http://127.0.0.1:5077
Lifewood__DataDirectory=/var/lib/unsafe path
EOF
expect_failure "unsafe managed value" env LIFEWOOD_INSTALLER_TEST_ENV_FILE="$unsafe_env" bash "$installer" --lang zh-CN --validate-only
grep -Fq "错误：配置字段 Lifewood__DataDirectory 的值不安全：$unsafe_env" "$temp_root/output.log"
grep -Fq '[是/否，默认否]' "$installer"
grep -Fq '"是"' "$installer"

missing_env="$temp_root/missing.env"
cat > "$missing_env" <<EOF
ASPNETCORE_URLS=http://127.0.0.1:5077
Lifewood__DataDirectory=/var/lib/lifewood-installer-missing-$$
EOF
expect_failure "missing recorded data" env LIFEWOOD_INSTALLER_TEST_ENV_FILE="$missing_env" bash "$installer" --validate-only

sudo chown "$(id -u):$(id -g)" "$recorded_data"
chmod 0700 "$recorded_data"
touch "$recorded_data/platform.db"
empty_proxy_env="$temp_root/empty-proxy.env"
cat > "$empty_proxy_env" <<EOF
ASPNETCORE_URLS=http://127.0.0.1:5077
Lifewood__DataDirectory=$recorded_data
Network__TrustedProxies__0=
EOF
env LIFEWOOD_INSTALLER_TEST_ENV_FILE="$empty_proxy_env" bash "$installer" --validate-only --trusted-proxy '' >/dev/null
grep -Fq "printf 'Network__TrustedProxies__0=%s\n'" "$installer" || {
  printf 'Installer must always override the managed trusted-proxy value.\n' >&2
  exit 1
}

printf 'Linux installer validation tests passed.\n'
