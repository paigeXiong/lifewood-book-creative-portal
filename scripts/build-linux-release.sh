#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$(uname -s)" == "Linux" ]] || { printf 'Linux release builds must run on Linux.\n' >&2; exit 2; }
actual_arch="$(uname -m)"
runtime="${1:-}"
if [[ -z "$runtime" ]]; then
  case "$actual_arch" in
    x86_64) runtime="linux-x64" ;;
    aarch64) runtime="linux-arm64" ;;
    *) printf 'Unsupported Linux host architecture: %s\n' "$actual_arch" >&2; exit 2 ;;
  esac
fi
case "$runtime" in
  linux-x64) expected_arch="x86_64" ;;
  linux-arm64) expected_arch="aarch64" ;;
  *) printf 'Unsupported Linux runtime: %s\n' "$runtime" >&2; exit 2 ;;
esac

if [[ "$actual_arch" != "$expected_arch" ]]; then
  printf 'Native AOT cross-compilation is not supported by this script: %s requires %s, current host is %s.\n' "$runtime" "$expected_arch" "$actual_arch" >&2
  exit 2
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repository_root="$(cd -- "$script_dir/.." && pwd -P)"
artifacts_root="$repository_root/artifacts"
staging_root="$artifacts_root/linux-release-staging"
release_root="$artifacts_root/release"

case "$staging_root" in
  "$artifacts_root"/*) ;;
  *) printf 'Unsafe staging directory: %s\n' "$staging_root" >&2; exit 2 ;;
esac

cleanup() {
  if [[ -d "$staging_root" ]]; then rm -rf -- "$staging_root"; fi
}
trap cleanup EXIT
cleanup
mkdir -p -- "$staging_root/api" "$staging_root/web/customer" "$staging_root/web/admin" "$staging_root/linux" "$release_root"

cd -- "$repository_root"
npm run build:web
npm run build:admin

[[ -f apps/task-entry-web/dist/index.html ]] || { printf 'Customer frontend output is missing.\n' >&2; exit 1; }
[[ -f apps/admin-web/dist/index.html ]] || { printf 'Administrator frontend output is missing.\n' >&2; exit 1; }
cp -a -- apps/task-entry-web/dist/. "$staging_root/web/customer/"
cp -a -- apps/admin-web/dist/. "$staging_root/web/admin/"

dotnet publish services/platform-api/Lifewood.PlatformApi.csproj \
  -c Release \
  -r "$runtime" \
  --self-contained true \
  -p:PublishAot=true \
  -o "$staging_root/api"

[[ -x "$staging_root/api/Lifewood.PlatformApi" ]] || { printf 'Native AOT API executable is missing.\n' >&2; exit 1; }
install -m 0755 linux/install.sh "$staging_root/linux/install.sh"
install -m 0644 linux/lifewood-book-portal.service "$staging_root/linux/lifewood-book-portal.service"
install -m 0644 docs/deployment-and-backup.md "$staging_root/linux/README.md"

if find "$staging_root" -type f \( -name 'platform.db' -o -name 'platform.lock' -o -name 'audit-pending.*' \) -print -quit | grep -q .; then
  printf 'Production data was found in the Linux release payload.\n' >&2
  exit 1
fi
if find "$staging_root" -type d \( -name data -o -name uploads -o -name deliveries -o -name data-protection-keys \) -print -quit | grep -q .; then
  printf 'A production data directory was found in the Linux release payload.\n' >&2
  exit 1
fi

revision="$(git rev-parse HEAD)"
short_revision="${revision:0:12}"
source_state="clean"
if [[ -n "$(git status --porcelain=v1 --untracked-files=all)" ]]; then source_state="dirty"; fi
version="$(node -p "require('./package.json').version")"
cat > "$staging_root/release-manifest.json" <<EOF
{
  "product": "Lifewood Book Creative Portal",
  "version": "$version",
  "revision": "$revision",
  "sourceState": "$source_state",
  "runtime": "$runtime",
  "paths": { "customer": "/", "admin": "/admin/", "api": "/api/" }
}
EOF

identity="$short_revision"
if [[ "$source_state" != "clean" ]]; then
  content_id="$(find "$staging_root" -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d ' ' -f 1)"
  identity="$short_revision-dirty-${content_id:0:12}"
fi
archive="$release_root/lifewood-book-creative-portal-$runtime-$identity.tar.gz"
rm -f -- "$archive" "$archive.sha256"

tar --sort=name --mtime="@${SOURCE_DATE_EPOCH:-$(git show -s --format=%ct HEAD)}" \
  --owner=0 --group=0 --numeric-owner \
  -czf "$archive" -C "$staging_root" .
(
  cd -- "$release_root"
  sha256sum "$(basename -- "$archive")" > "$(basename -- "$archive").sha256"
)

printf 'Linux release package created: %s\n' "$archive"
printf 'SHA256: %s\n' "$(cut -d ' ' -f 1 "$archive.sha256")"
