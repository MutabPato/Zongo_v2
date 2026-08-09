#!/usr/bin/env sh
set -eu

BASE_URL="${1:?usage: verify-preview.sh https://admin-preview.example.internal}"

check_header() {
  url="$1"
  header="$2"
  curl -fsS -D - "$url" -o /dev/null | grep -i "^${header}:" >/dev/null
}

curl -fsS "${BASE_URL}/backoffice/" -o /dev/null
curl -fsS "${BASE_URL}/backoffice/transactions" -o /dev/null
curl -fsS "${BASE_URL}/admin/v1/openapi-json" -o /dev/null
check_header "${BASE_URL}/backoffice/" "content-security-policy"
check_header "${BASE_URL}/backoffice/" "x-content-type-options"

entry_headers="$(curl -fsS -D - "${BASE_URL}/backoffice/" -o /dev/null)"
printf '%s\n' "$entry_headers" | grep -i '^cache-control:.*no-cache' >/dev/null
asset_path="$(curl -fsS "${BASE_URL}/backoffice/" | sed -nE 's#.*(assets/[A-Za-z0-9._-]+\.(js|css)).*#\1#p' | head -n 1)"
test -n "$asset_path"
asset_headers="$(curl -fsS -D - "${BASE_URL}/backoffice/${asset_path}" -o /dev/null)"
printf '%s\n' "$asset_headers" | grep -i '^cache-control:.*immutable' >/dev/null

echo "preview routing and security headers passed: ${BASE_URL}"
