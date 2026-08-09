#!/usr/bin/env sh
set -eu

BASE_URL="${1:-http://127.0.0.1:4173}"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/zongo-admin-smoke.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

status_code() {
  curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "$@"
}

expect_status() {
  expected="$1"
  shift
  actual="$(status_code "$@")"
  test "$actual" = "$expected" || {
    echo "expected HTTP ${expected}, received ${actual}" >&2
    exit 1
  }
}

expect_status 200 "${BASE_URL}/backoffice/"
expect_status 200 "${BASE_URL}/backoffice/transactions"
expect_status 200 "${BASE_URL}/admin/v1/openapi-json"
expect_status 401 "${BASE_URL}/admin/v1/auth/session"
expect_status 401 -H 'Authorization: Bearer legacy-compatibility-token' \
  "${BASE_URL}/admin/v1/auth/session"

if [ -n "${ADMIN_SMOKE_USER:-}" ] && [ -n "${ADMIN_SMOKE_TOTP:-}" ]; then
  LOGIN_HEADERS="${TMP_DIR}/login.headers"
  LOGIN_BODY="${TMP_DIR}/login.json"
  COOKIE_JAR="${TMP_DIR}/cookies.txt"

  curl -sS --max-time 10 -D "$LOGIN_HEADERS" -o "$LOGIN_BODY" \
    -c "$COOKIE_JAR" -H 'Content-Type: application/json' \
    -X POST "${BASE_URL}/admin/v1/auth/login" \
    --data "{\"userId\":\"${ADMIN_SMOKE_USER}\",\"totpCode\":\"${ADMIN_SMOKE_TOTP}\"}"
  jq -e 'has("accessToken") | not' "$LOGIN_BODY" >/dev/null
  grep -qi 'HttpOnly' "$LOGIN_HEADERS"
  grep -Eqi 'SameSite=Lax' "$LOGIN_HEADERS"
  grep -Eqi 'Path=/' "$LOGIN_HEADERS"

  expect_status 200 -b "$COOKIE_JAR" "${BASE_URL}/admin/v1/auth/session"
  CSRF_TOKEN="$(curl -fsS --max-time 10 -b "$COOKIE_JAR" \
    "${BASE_URL}/admin/v1/auth/csrf" | jq -r '.token')"
  test -n "$CSRF_TOKEN" && test "$CSRF_TOKEN" != null

  expect_status 403 -b "$COOKIE_JAR" -X POST \
    "${BASE_URL}/admin/v1/auth/logout"
  expect_status 400 -b "$COOKIE_JAR" \
    "${BASE_URL}/admin/v1/operations/search?status=COMPLETED"
  expect_status 201 -b "$COOKIE_JAR" -X POST \
    -H "X-CSRF-Token: ${CSRF_TOKEN}" "${BASE_URL}/admin/v1/auth/logout"
fi

echo "admin contract smoke passed: ${BASE_URL}"
