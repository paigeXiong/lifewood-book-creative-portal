#!/usr/bin/env bash
set -Eeuo pipefail

product_name="Lifewood Book Creative Portal"
service_name="lifewood-book-portal"
service_user="lifewood-portal"
install_dir="/opt/lifewood-book-portal"
config_dir="/etc/lifewood-book-portal"
env_file="$config_dir/portal.env"
unit_file="/etc/systemd/system/$service_name.service"
default_data_dir="/var/lib/lifewood-book-portal"
coordination_dir="/var/lib/lifewood-book-portal-coordination"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
payload_root="$(cd -- "$script_dir/.." && pwd -P)"

port="5077"
data_dir="$default_data_dir"
trusted_proxy="127.0.0.1"
if [[ "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" == zh* ]]; then language="zh-CN"; else language="en-US"; fi
non_interactive=false
configure_only=false
validate_only=false
port_explicit=false
data_explicit=false
proxy_explicit=false

arguments=("$@")
for ((argument_index=0; argument_index + 1 < ${#arguments[@]}; argument_index++)); do
  if [[ "${arguments[argument_index]}" == "--lang" && "${arguments[argument_index + 1]}" =~ ^(zh-CN|en-US)$ ]]; then
    language="${arguments[argument_index + 1]}"
  fi
done

usage() {
  if [[ "$language" == "zh-CN" ]]; then
    cat <<'EOF'
用法：sudo ./install.sh [选项]

选项：
  --port PORT              本机 HTTP 端口（1024-65535，默认 5077）
  --data-dir PATH          生产数据目录（默认 /var/lib/lifewood-book-portal）
  --trusted-proxy IP       TLS 反向代理地址（默认 127.0.0.1，留空禁用）
  --lang zh-CN|en-US       安装器语言
  --non-interactive        使用参数值，不打开终端界面或要求确认
  --configure-only         只更新配置，不替换程序文件
  --validate-only          只校验参数和已有配置，不执行安装
  --help                   显示帮助

安装完成后运行 sudo lifewood-portal-configure 可重新打开配置界面。
覆盖安装会锁定原生产数据目录，命令行参数不能把升级重定向到新目录。
EOF
  else
    cat <<'EOF'
Usage: sudo ./install.sh [options]

Options:
  --port PORT              Loopback HTTP port (1024-65535, default: 5077)
  --data-dir PATH          Persistent data directory (default: /var/lib/lifewood-book-portal)
  --trusted-proxy IP       TLS reverse-proxy address (default: 127.0.0.1, empty disables)
  --lang zh-CN|en-US       Installer language
  --non-interactive        Use supplied values without a TUI or confirmation
  --configure-only         Update configuration without replacing program files
  --validate-only          Validate options and recorded configuration without installing
  --help                   Show this help

Re-run the installed command `sudo lifewood-portal-configure` to open the
configuration UI. On upgrades the existing data directory is locked and cannot
be redirected by command-line options.
EOF
  fi
}

translate_error_zh() {
  local english="$1" detail
  case "$english" in
    "--port requires a value") printf '%s' "--port 需要一个值" ;;
    "--data-dir requires a value") printf '%s' "--data-dir 需要一个值" ;;
    "--trusted-proxy requires a value") printf '%s' "--trusted-proxy 需要一个值" ;;
    "--lang requires a value") printf '%s' "--lang 需要一个值" ;;
    "Unknown option: "*) printf '未知选项：%s' "${english#Unknown option: }" ;;
    "--lang must be zh-CN or en-US") printf '%s' "--lang 必须是 zh-CN 或 en-US" ;;
    "GNU realpath is required for safe path validation.") printf '%s' "安全路径校验需要 GNU realpath" ;;
    "getent is required for IP-address validation.") printf '%s' "IP 地址校验需要 getent" ;;
    "Configuration contains duplicate "*)
      detail="${english#Configuration contains duplicate }"
      printf '配置包含重复字段 %s：%s' "${detail%% assignments:*}" "${detail#* assignments: }"
      ;;
    "Configuration is missing "*) printf '配置缺少字段：%s' "${english#Configuration is missing }" ;;
    "Configuration contains an unsafe "*)
      detail="${english#Configuration contains an unsafe }"
      printf '配置字段 %s 的值不安全：%s' "${detail%% value:*}" "${detail#* value: }"
      ;;
    "An existing installation was found, but its data-directory record is missing. Refusing to continue.") printf '%s' "检测到已有安装，但生产数据目录记录缺失，已中止操作" ;;
    "The existing data-directory record is empty. Refusing to redirect an upgrade to a new directory.") printf '%s' "已有生产数据目录记录为空，不能把升级重定向到新目录" ;;
    "The production data directory is locked to "*)
      detail="${english#The production data directory is locked to }"
      detail="${detail%. Back up and migrate it explicitly instead.}"
      printf '生产数据目录已锁定：%s。请先单独备份并迁移数据' "$detail"
      ;;
    "No TUI is available. Install dialog/whiptail or use --non-interactive.") printf '%s' "没有可用的终端界面。请安装 dialog/whiptail，或使用 --non-interactive" ;;
    "Port must be a number.") printf '%s' "端口必须是数字" ;;
    "Port must be between 1024 and 65535.") printf '%s' "端口必须介于 1024 和 65535 之间" ;;
    "The data directory must be an absolute path.") printf '%s' "生产数据目录必须是绝对路径" ;;
    "The data directory contains unsupported characters.") printf '%s' "生产数据目录包含不支持的字符" ;;
    "The trusted proxy contains unsupported characters.") printf '%s' "可信代理地址包含不支持的字符" ;;
    "The data directory must not contain '..', '.', or symbolic-link components: "*) printf '生产数据目录不能包含 ..、. 或符号链接路径：%s' "${english##*: }" ;;
    "The data directory points to a protected system tree: "*) printf '生产数据目录指向受保护的系统目录：%s' "${english##*: }" ;;
    "Choose a dedicated child directory instead of a shared system or mount root: "*) printf '请选择专用子目录，不要直接使用共享系统目录或挂载根目录：%s' "${english##*: }" ;;
    "The recorded production data directory is missing or not mounted: "*) printf '记录的生产数据目录不存在或尚未挂载：%s' "${english##*: }" ;;
    "The recorded production data directory cannot be a symbolic link.") printf '%s' "记录的生产数据目录不能是符号链接" ;;
    "The recorded production database is missing or unsafe: "*) printf '记录的生产数据库不存在或不安全：%s' "${english##*: }" ;;
    "Trusted proxy must be an IPv4 or IPv6 address.") printf '%s' "可信代理必须是 IPv4 或 IPv6 地址" ;;
    "Trusted proxy must be a canonical IPv4 or IPv6 address: "*) printf '可信代理必须是规范的 IPv4 或 IPv6 地址：%s' "${english##*: }" ;;
    "Run this command with sudo or as root.") printf '%s' "请使用 sudo 或 root 身份运行此命令" ;;
    "systemd is required.") printf '%s' "安装需要 systemd" ;;
    "The install utility is required.") printf '%s' "安装需要 install 命令" ;;
    "curl is required for the startup health check.") printf '%s' "启动健康检查需要 curl" ;;
    "runuser is required to verify production-data permissions.") printf '%s' "生产数据权限检查需要 runuser" ;;
    "GNU stat is required for safe ownership validation.") printf '%s' "所有者安全检查需要 GNU stat" ;;
    "Linux server executable is missing from the release payload.") printf '%s' "发布包缺少 Linux 服务端程序" ;;
    "Customer frontend is missing from the release payload.") printf '%s' "发布包缺少客户门户" ;;
    "Administrator frontend is missing from the release payload.") printf '%s' "发布包缺少管理中心" ;;
    "systemd unit is missing from the release payload.") printf '%s' "发布包缺少 systemd 单元文件" ;;
    "The portal is not installed at "*) printf '指定目录中没有已安装的平台：%s' "${english#The portal is not installed at }" ;;
    "The selected data target is not a safe directory: "*) printf '选择的生产数据目标不是安全目录：%s' "${english##*: }" ;;
    "An existing first-install data directory must be empty: "*) printf '首次安装使用的已有数据目录必须为空：%s' "${english##*: }" ;;
    "An existing first-install data directory must be owned by "*) printf '首次安装使用的已有数据目录所有者不正确：%s' "${english#An existing first-install data directory must be owned by }" ;;
    "The service account cannot write the selected data directory: "*) printf '服务账号不能写入选择的数据目录：%s' "${english##*: }" ;;
    "The service account cannot read and write the recorded production data directory: "*) printf '服务账号不能读写记录的生产数据目录：%s' "${english##*: }" ;;
    "Unable to query the current systemd service state.") printf '%s' "无法查询当前 systemd 服务状态" ;;
    "The service unit exists on disk but systemd does not have a stable loaded state. Run systemctl daemon-reload and inspect the unit.") printf '%s' "服务单元已存在，但 systemd 未处于稳定加载状态。请运行 systemctl daemon-reload 并检查服务" ;;
    "Unable to query the current systemd active state.") printf '%s' "无法查询当前 systemd 活动状态" ;;
    "The existing service is failed. Repair or explicitly stop it before installing.") printf '%s' "现有服务处于失败状态。请先修复或明确停止服务" ;;
    "The existing service is in a transitional state ("*)
      detail="${english#The existing service is in a transitional state (}"
      detail="${detail%). Wait for it to settle before installing.}"
      printf '现有服务正在切换状态，请等待状态稳定后重试：%s' "$detail"
      ;;
    "Unable to query whether the current systemd service is enabled.") printf '%s' "无法查询当前 systemd 服务是否启用" ;;
    "The existing service is masked. Unmask and inspect it before installing.") printf '%s' "现有服务已被屏蔽。请先解除屏蔽并检查服务" ;;
    "The existing service has an unsupported unit-file state ("*)
      detail="${english#The existing service has an unsupported unit-file state (}"
      printf '现有服务的单元文件状态不受支持：%s' "${detail%)}"
      ;;
    "The existing service has an unsupported load state ("*)
      detail="${english#The existing service has an unsupported load state (}"
      printf '现有服务的加载状态不受支持：%s' "${detail%)}"
      ;;
    "Could not stop the existing service.") printf '%s' "无法停止现有服务" ;;
    "The existing service is still active after stop.") printf '%s' "执行停止后，现有服务仍处于活动状态" ;;
    "The selected port is already serving another process: "*) printf '选择的端口已被其他进程使用：%s' "${english##*: }" ;;
    "Rollback directory already exists: "*) printf '回滚目录已存在：%s' "${english##*: }" ;;
    "Service startup failed. Inspect: "*) printf '服务启动失败，请检查：%s' "${english#Service startup failed. Inspect: }" ;;
    *) printf '%s' "$english" ;;
  esac
}

fail() {
  local rendered="$*"
  if [[ "$language" == "zh-CN" ]]; then rendered="$(translate_error_zh "$rendered")"; fi
  if [[ "$language" == "zh-CN" ]]; then printf '错误：%s\n' "$rendered" >&2; else printf 'ERROR: %s\n' "$rendered" >&2; fi
  exit 1
}

while (($# > 0)); do
  case "$1" in
    --port)
      (($# >= 2)) || fail "--port requires a value"
      port="$2"; port_explicit=true; shift 2 ;;
    --data-dir)
      (($# >= 2)) || fail "--data-dir requires a value"
      data_dir="$2"; data_explicit=true; shift 2 ;;
    --trusted-proxy)
      (($# >= 2)) || fail "--trusted-proxy requires a value"
      trusted_proxy="$2"; proxy_explicit=true; shift 2 ;;
    --lang)
      (($# >= 2)) || fail "--lang requires a value"
      language="$2"; shift 2 ;;
    --non-interactive) non_interactive=true; shift ;;
    --configure-only) configure_only=true; shift ;;
    --validate-only) validate_only=true; non_interactive=true; shift ;;
    --help|-h) usage; exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
done

if [[ "$(basename -- "$0")" == "lifewood-portal-configure" ]]; then
  configure_only=true
fi
if $validate_only && [[ -n "${LIFEWOOD_INSTALLER_TEST_ENV_FILE:-}" ]]; then
  env_file="$LIFEWOOD_INSTALLER_TEST_ENV_FILE"
fi

[[ "$language" == "zh-CN" || "$language" == "en-US" ]] || fail "--lang must be zh-CN or en-US"

message() {
  local key="$1"
  if [[ "$language" == "zh-CN" ]]; then
    case "$key" in
      title) printf '%s' "Lifewood 书籍创意门户配置" ;;
      port) printf '%s' "本机监听端口（1024-65535）" ;;
      data) printf '%s' "生产数据目录（升级后不可更改）" ;;
      proxy) printf '%s' "HTTPS 反向代理 IP（留空表示不信任代理）" ;;
      port_label) printf '%s' "端口" ;;
      data_label) printf '%s' "数据目录" ;;
      proxy_label) printf '%s' "可信代理" ;;
      none) printf '%s' "无" ;;
      confirm) printf '%s' "确认应用以上配置？" ;;
      locked) printf '%s' "升级将继续使用现有生产数据目录" ;;
      done) printf '%s' "安装和启动完成" ;;
      configured) printf '%s' "配置已更新，服务已重启" ;;
      cancelled) printf '%s' "操作已取消" ;;
      valid) printf '%s' "配置有效" ;;
      transaction_restore) printf '%s' "安装事务失败，正在恢复先前的程序和配置" ;;
      rollback_incomplete) printf '%s' "回滚未完整完成。请在开放访问前检查 systemctl status 和 journalctl" ;;
      data_record_preserved) printf '%s' "检测到首次启动已写入生产数据，已保留数据目录记录" ;;
      customer) printf '%s' "客户门户" ;;
      admin) printf '%s' "管理中心" ;;
      status) printf '%s' "服务状态" ;;
    esac
  else
    case "$key" in
      title) printf '%s' "Lifewood Book Creative Portal setup" ;;
      port) printf '%s' "Loopback port (1024-65535)" ;;
      data) printf '%s' "Production data directory (locked after installation)" ;;
      proxy) printf '%s' "HTTPS reverse-proxy IP (empty trusts no proxy)" ;;
      port_label) printf '%s' "Port" ;;
      data_label) printf '%s' "Data" ;;
      proxy_label) printf '%s' "Trusted proxy" ;;
      none) printf '%s' "none" ;;
      confirm) printf '%s' "Apply this configuration?" ;;
      locked) printf '%s' "The upgrade will keep the existing production data directory" ;;
      done) printf '%s' "Installation and startup completed" ;;
      configured) printf '%s' "Configuration updated and service restarted" ;;
      cancelled) printf '%s' "Operation cancelled" ;;
      valid) printf '%s' "Configuration is valid" ;;
      transaction_restore) printf '%s' "Installation transaction failed; restoring the previous program and configuration" ;;
      rollback_incomplete) printf '%s' "ROLLBACK INCOMPLETE: inspect systemctl status and journalctl before serving traffic" ;;
      data_record_preserved) printf '%s' "The first startup wrote production data; preserving its data-directory record" ;;
      customer) printf '%s' "Customer" ;;
      admin) printf '%s' "Admin" ;;
      status) printf '%s' "Status" ;;
    esac
  fi
}

command -v realpath >/dev/null 2>&1 || fail "GNU realpath is required for safe path validation."
command -v getent >/dev/null 2>&1 || fail "getent is required for IP-address validation."

read_env_value() {
  local key="$1" file="$2" required="${3:-false}" allow_empty="${4:-false}" value
  local -a matches=()
  mapfile -t matches < <(grep -E "^${key}=" "$file" 2>/dev/null || true)
  if ((${#matches[@]} > 1)); then fail "Configuration contains duplicate ${key} assignments: $file"; fi
  if ((${#matches[@]} == 0)); then
    if [[ "$required" == true ]]; then fail "Configuration is missing ${key}: $file"; fi
    return 0
  fi
  value="${matches[0]#*=}"
  if [[ -z "$value" && "$allow_empty" == true ]]; then return 0; fi
  [[ -n "$value" && "$value" != *[[:space:]]* && "$value" != *'#'* && "$value" != *'='* && "$value" != *'\'* && "$value" != *'"'* && "$value" != *"'"* ]] ||
    fail "Configuration contains an unsafe ${key} value: $file"
  printf '%s' "$value"
}

existing_data_dir=""
existing_port=""
if [[ -d "$install_dir" && ! -f "$env_file" ]]; then
  fail "An existing installation was found, but its data-directory record is missing. Refusing to continue."
fi
if [[ -f "$env_file" ]]; then
  existing_data_dir="$(read_env_value "Lifewood__DataDirectory" "$env_file" true)"
  existing_urls="$(read_env_value "ASPNETCORE_URLS" "$env_file" true)"
  existing_proxy="$(read_env_value "Network__TrustedProxies__0" "$env_file" false true)"
  existing_port="${existing_urls##*:}"
  if [[ -d "$install_dir" && -z "$existing_data_dir" ]]; then
    fail "The existing data-directory record is empty. Refusing to redirect an upgrade to a new directory."
  fi
  if [[ -n "$existing_data_dir" ]]; then
    if $data_explicit && [[ "$data_dir" != "$existing_data_dir" ]]; then
      fail "The production data directory is locked to $existing_data_dir. Back up and migrate it explicitly instead."
    fi
    data_dir="$existing_data_dir"
  fi
  if ! $port_explicit && [[ "$existing_port" =~ ^[0-9]+$ ]]; then port="$existing_port"; fi
  if ! $proxy_explicit; then trusted_proxy="$existing_proxy"; fi
fi

ui_input() {
  local prompt="$1" initial="$2" result
  if command -v dialog >/dev/null 2>&1; then
    result="$(dialog --stdout --title "$(message title)" --inputbox "$prompt" 9 68 "$initial")" || return 1
  elif command -v whiptail >/dev/null 2>&1; then
    result="$(whiptail --title "$(message title)" --inputbox "$prompt" 9 68 "$initial" 3>&1 1>&2 2>&3)" || return 1
  elif [[ -t 0 && -t 1 ]]; then
    read -r -p "$prompt [$initial]: " result || return 1
    result="${result:-$initial}"
  else
    fail "No TUI is available. Install dialog/whiptail or use --non-interactive."
  fi
  printf '%s' "$result"
}

ui_confirm() {
  local prompt="$1"
  if command -v dialog >/dev/null 2>&1; then
    dialog --title "$(message title)" --yesno "$prompt" 9 68
  elif command -v whiptail >/dev/null 2>&1; then
    whiptail --title "$(message title)" --yesno "$prompt" 9 68
  elif [[ -t 0 && -t 1 ]]; then
    local answer
    if [[ "$language" == "zh-CN" ]]; then
      read -r -p "$prompt [是/否，默认否]: " answer
      [[ "$answer" == "是" || "$answer" == "y" || "$answer" == "Y" ]]
    else
      read -r -p "$prompt [y/N]: " answer
      [[ "$answer" == "y" || "$answer" == "Y" ]]
    fi
  else
    return 1
  fi
}

if ! $non_interactive; then
  port="$(ui_input "$(message port)" "$port")" || { printf '%s\n' "$(message cancelled)"; exit 1; }
  if [[ -z "$existing_data_dir" ]]; then
    data_dir="$(ui_input "$(message data)" "$data_dir")" || { printf '%s\n' "$(message cancelled)"; exit 1; }
  else
    printf '%s: %s\n' "$(message locked)" "$data_dir"
  fi
  trusted_proxy="$(ui_input "$(message proxy)" "$trusted_proxy")" || { printf '%s\n' "$(message cancelled)"; exit 1; }
  summary="$(printf '%s\n\n%s: %s\n%s: %s\n%s: %s' "$(message confirm)" "$(message port_label)" "$port" "$(message data_label)" "$data_dir" "$(message proxy_label)" "${trusted_proxy:-$(message none)}")"
  ui_confirm "$summary" || {
    printf '%s\n' "$(message cancelled)"
    exit 1
  }
fi

[[ "$port" =~ ^[0-9]+$ ]] || fail "Port must be a number."
((port >= 1024 && port <= 65535)) || fail "Port must be between 1024 and 65535."
[[ "$data_dir" == /* ]] || fail "The data directory must be an absolute path."
[[ "$data_dir" != *[[:space:]]* && "$data_dir" != *'#'* && "$data_dir" != *'='* && "$data_dir" != *'\'* && "$data_dir" != *'"'* ]] || fail "The data directory contains unsupported characters."
[[ "$trusted_proxy" != *[[:space:]]* && "$trusted_proxy" != *'#'* && "$trusted_proxy" != *'='* && "$trusted_proxy" != *'\'* && "$trusted_proxy" != *'"'* ]] || fail "The trusted proxy contains unsupported characters."

requested_data_dir="${data_dir%/}"
[[ -n "$requested_data_dir" ]] || requested_data_dir="/"
canonical_data_dir="$(realpath -m -- "$requested_data_dir")"
[[ "$canonical_data_dir" == "$requested_data_dir" ]] || fail "The data directory must not contain '..', '.', or symbolic-link components: $data_dir"
data_dir="$canonical_data_dir"
case "$data_dir" in
  /|/bin|/bin/*|/boot|/boot/*|/dev|/dev/*|/etc|/etc/*|/home|/home/*|/lib|/lib/*|/lib64|/lib64/*|/opt|/opt/*|/proc|/proc/*|/root|/root/*|/run|/run/*|/sbin|/sbin/*|/sys|/sys/*|/tmp|/tmp/*|/usr|/usr/*|/var|/var/lib)
    fail "The data directory points to a protected system tree: $data_dir" ;;
  /data|/media|/mnt|/srv|/var/cache|/var/log|/var/spool|/var/tmp)
    fail "Choose a dedicated child directory instead of a shared system or mount root: $data_dir" ;;
esac

if [[ -n "$existing_data_dir" ]]; then
  [[ -d "$data_dir" ]] || fail "The recorded production data directory is missing or not mounted: $data_dir"
  [[ ! -L "$data_dir" ]] || fail "The recorded production data directory cannot be a symbolic link."
  [[ -f "$data_dir/platform.db" && ! -L "$data_dir/platform.db" ]] || fail "The recorded production database is missing or unsafe: $data_dir/platform.db"
fi
if [[ -n "$trusted_proxy" ]]; then
  [[ "$trusted_proxy" =~ ^[0-9A-Fa-f:.]+$ ]] || fail "Trusted proxy must be an IPv4 or IPv6 address."
  if ! getent ahosts "$trusted_proxy" 2>/dev/null | awk '{print $1}' | grep -Fqx -- "$trusted_proxy"; then
    fail "Trusted proxy must be a canonical IPv4 or IPv6 address: $trusted_proxy"
  fi
fi

if $validate_only; then
  printf '%s: %s=%s %s=%s %s=%s\n' "$(message valid)" "$(message port_label)" "$port" "$(message data_label)" "$data_dir" "$(message proxy_label)" "${trusted_proxy:-$(message none)}"
  exit 0
fi

[[ "${EUID:-$(id -u)}" -eq 0 ]] || fail "Run this command with sudo or as root."
command -v systemctl >/dev/null 2>&1 || fail "systemd is required."
command -v install >/dev/null 2>&1 || fail "The install utility is required."
command -v curl >/dev/null 2>&1 || fail "curl is required for the startup health check."
command -v runuser >/dev/null 2>&1 || fail "runuser is required to verify production-data permissions."
command -v stat >/dev/null 2>&1 || fail "GNU stat is required for safe ownership validation."

if ! $configure_only; then
  [[ -x "$payload_root/server/Lifewood.BookPortal.Server" ]] || fail "Linux server executable is missing from the release payload."
  [[ -f "$payload_root/server/web/customer/index.html" ]] || fail "Customer frontend is missing from the release payload."
  [[ -f "$payload_root/server/web/admin/index.html" ]] || fail "Administrator frontend is missing from the release payload."
  [[ -f "$script_dir/lifewood-book-portal.service" ]] || fail "systemd unit is missing from the release payload."
else
  [[ -x "$install_dir/server/Lifewood.BookPortal.Server" ]] || fail "The portal is not installed at $install_dir."
fi

if ! getent group "$service_user" >/dev/null 2>&1; then groupadd --system "$service_user"; fi
if ! id "$service_user" >/dev/null 2>&1; then
  useradd --system --gid "$service_user" --home-dir "$data_dir" --shell /usr/sbin/nologin "$service_user"
fi

if [[ -z "$existing_data_dir" ]]; then
  if [[ -e "$data_dir" ]]; then
    [[ -d "$data_dir" && ! -L "$data_dir" ]] || fail "The selected data target is not a safe directory: $data_dir"
    [[ -z "$(find "$data_dir" -mindepth 1 -maxdepth 1 -print -quit)" ]] || fail "An existing first-install data directory must be empty: $data_dir"
    [[ "$(stat -c '%U' "$data_dir")" == "$service_user" ]] || fail "An existing first-install data directory must be owned by $service_user: $data_dir"
    runuser -u "$service_user" -- test -w "$data_dir" || fail "The service account cannot write the selected data directory: $data_dir"
  else
    install -d -m 0750 -o "$service_user" -g "$service_user" "$data_dir"
  fi
elif ! runuser -u "$service_user" -- test -r "$data_dir/platform.db" || ! runuser -u "$service_user" -- test -w "$data_dir"; then
  fail "The service account cannot read and write the recorded production data directory: $data_dir"
fi
install -d -m 0755 -o root -g root "$config_dir"
install -d -m 0750 -o "$service_user" -g "$service_user" "$coordination_dir"

configure_command="/usr/local/sbin/lifewood-portal-configure"
had_install=false
had_env=false
had_unit=false
had_configure_command=false
[[ -d "$install_dir" ]] && had_install=true
[[ -f "$env_file" ]] && had_env=true
[[ -f "$unit_file" ]] && had_unit=true
[[ -f "$configure_command" ]] && had_configure_command=true

env_backup=""
unit_backup=""
configure_backup=""
if $had_env; then env_backup="$(mktemp)"; cp -a -- "$env_file" "$env_backup"; fi
if $had_unit; then unit_backup="$(mktemp)"; cp -a -- "$unit_file" "$unit_backup"; fi
if $had_configure_command; then configure_backup="$(mktemp)"; cp -a -- "$configure_command" "$configure_backup"; fi
env_temp="$(mktemp "$config_dir/.portal.env.XXXXXX")"
rollback_dir=""
stage_dir=""
transaction_active=false
program_replaced=false
was_active=false
was_enabled=false
service_load_state="$(systemctl show "$service_name.service" --property=LoadState --value 2>/dev/null)" ||
  fail "Unable to query the current systemd service state."
case "$service_load_state" in
  not-found)
    $had_unit && fail "The service unit exists on disk but systemd does not have a stable loaded state. Run systemctl daemon-reload and inspect the unit."
    ;;
  loaded)
    service_active_state="$(systemctl show "$service_name.service" --property=ActiveState --value 2>/dev/null)" ||
      fail "Unable to query the current systemd active state."
    case "$service_active_state" in
      active) was_active=true ;;
      inactive) ;;
      failed) fail "The existing service is failed. Repair or explicitly stop it before installing." ;;
      *) fail "The existing service is in a transitional state ($service_active_state). Wait for it to settle before installing." ;;
    esac
    service_unit_state="$(systemctl show "$service_name.service" --property=UnitFileState --value 2>/dev/null)" ||
      fail "Unable to query whether the current systemd service is enabled."
    case "$service_unit_state" in
      enabled|enabled-runtime) was_enabled=true ;;
      disabled|static|indirect|generated|transient) ;;
      masked|masked-runtime) fail "The existing service is masked. Unmask and inspect it before installing." ;;
      *) fail "The existing service has an unsupported unit-file state ($service_unit_state)." ;;
    esac
    ;;
  *) fail "The existing service has an unsupported load state ($service_load_state)." ;;
esac

wait_for_health() {
  local expected_port="$1" body main_pid
  for _ in {1..30}; do
    if systemctl is-active --quiet "$service_name.service"; then
      main_pid="$(systemctl show "$service_name.service" --property MainPID --value 2>/dev/null || true)"
      body="$(curl --fail --silent --max-time 2 "http://127.0.0.1:$expected_port/api/health" 2>/dev/null || true)"
      if [[ "$main_pid" =~ ^[1-9][0-9]*$ && "$body" == *'"status":"ok"'* ]]; then return 0; fi
    fi
    sleep 1
  done
  return 1
}

cleanup() {
  local status="$?"
  local rollback_healthy=true
  set +e
  if $transaction_active; then
    printf '%s.\n' "$(message transaction_restore)" >&2
    systemctl stop "$service_name.service" 2>/dev/null || rollback_healthy=false
    if $program_replaced; then
      rm -rf -- "$install_dir" || rollback_healthy=false
      if $had_install && [[ -n "$rollback_dir" && -d "$rollback_dir" ]]; then
        mv -- "$rollback_dir" "$install_dir" || rollback_healthy=false
      fi
    fi
    if $had_env; then
      cp -a -- "$env_backup" "$env_file" || rollback_healthy=false
    elif [[ -d "$data_dir" && -n "$(find "$data_dir" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
      if [[ -f "$env_file" ]]; then
        printf '%s.\n' "$(message data_record_preserved)" >&2
      else
        rollback_healthy=false
      fi
    else
      rm -f -- "$env_file" || rollback_healthy=false
    fi
    if $had_unit; then cp -a -- "$unit_backup" "$unit_file" || rollback_healthy=false; else rm -f -- "$unit_file" || rollback_healthy=false; fi
    if $had_configure_command; then cp -a -- "$configure_backup" "$configure_command" || rollback_healthy=false; else rm -f -- "$configure_command" || rollback_healthy=false; fi
    systemctl daemon-reload 2>/dev/null || rollback_healthy=false
    if $was_enabled; then systemctl enable "$service_name.service" >/dev/null 2>&1 || rollback_healthy=false; else systemctl disable "$service_name.service" >/dev/null 2>&1 || rollback_healthy=false; fi
    if $was_active; then
      if ! systemctl restart "$service_name.service" 2>/dev/null; then
        rollback_healthy=false
      elif ! wait_for_health "$existing_port"; then
        rollback_healthy=false
      fi
    else
      systemctl stop "$service_name.service" 2>/dev/null || rollback_healthy=false
    fi
    if ! $rollback_healthy; then
      printf '%s.\n' "$(message rollback_incomplete)" >&2
    fi
  fi
  if [[ -n "$stage_dir" && -d "$stage_dir" ]]; then rm -rf -- "$stage_dir"; fi
  rm -f -- "$env_temp" 2>/dev/null || true
  [[ -z "$env_backup" ]] || rm -f -- "$env_backup" 2>/dev/null || true
  [[ -z "$unit_backup" ]] || rm -f -- "$unit_backup" 2>/dev/null || true
  [[ -z "$configure_backup" ]] || rm -f -- "$configure_backup" 2>/dev/null || true
  return "$status"
}
trap cleanup EXIT

{
  printf 'ASPNETCORE_URLS=http://127.0.0.1:%s\n' "$port"
  printf 'Lifewood__DataDirectory=%s\n' "$data_dir"
  printf 'Lifewood__CoordinationDirectory=%s\n' "$coordination_dir"
  printf 'Lifewood__WebRoot=%s/server/web\n' "$install_dir"
  printf 'Network__TrustedProxies__0=%s\n' "$trusted_proxy"
} > "$env_temp"
chmod 0600 "$env_temp"
chown root:root "$env_temp"

if ! $configure_only; then
  stage_dir="$(mktemp -d "/opt/.lifewood-book-portal.XXXXXX")"
  install -d -m 0755 "$stage_dir/server"
  cp -a -- "$payload_root/server/." "$stage_dir/server/"
  chmod 0755 "$stage_dir/server/Lifewood.BookPortal.Server"
  chown -R root:root "$stage_dir"
fi

transaction_active=true
if $was_active; then
  systemctl stop "$service_name.service" || fail "Could not stop the existing service."
  systemctl is-active --quiet "$service_name.service" && fail "The existing service is still active after stop."
fi
if curl --silent --max-time 2 "http://127.0.0.1:$port/" >/dev/null 2>&1; then
  fail "The selected port is already serving another process: $port"
fi

if ! $configure_only; then
  if [[ -e "$install_dir" ]]; then
    rollback_dir="${install_dir}.previous.$$"
    [[ ! -e "$rollback_dir" ]] || fail "Rollback directory already exists: $rollback_dir"
    mv -- "$install_dir" "$rollback_dir"
    program_replaced=true
  fi
  mv -- "$stage_dir" "$install_dir"
  stage_dir=""
  program_replaced=true
  install -m 0644 -o root -g root "$script_dir/lifewood-book-portal.service" "$unit_file"
  install -m 0755 -o root -g root "$script_dir/install.sh" "$configure_command"
fi

mv -f -- "$env_temp" "$env_file"
systemctl daemon-reload
systemctl enable "$service_name.service" >/dev/null

startup_ok=false
if systemctl restart "$service_name.service"; then
  if wait_for_health "$port"; then startup_ok=true; fi
fi

if ! $startup_ok; then
  fail "Service startup failed. Inspect: journalctl -u $service_name.service"
fi

transaction_active=false
if [[ -n "$rollback_dir" && -d "$rollback_dir" ]]; then rm -rf -- "$rollback_dir"; fi

if $configure_only; then
  printf '%s\n' "$(message configured)"
else
  printf '%s\n' "$(message done)"
fi
printf '%s: http://127.0.0.1:%s/%s/tasks\n' "$(message customer)" "$port" "$language"
printf '%s: http://127.0.0.1:%s/admin/%s/overview\n' "$(message admin)" "$port" "$language"
printf '%s: systemctl status %s.service\n' "$(message status)" "$service_name"
