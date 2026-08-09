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

echo "preview routing and security headers passed: ${BASE_URL}"
