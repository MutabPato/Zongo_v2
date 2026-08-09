#!/usr/bin/env sh
set -eu

BASE_URL="${1:-http://127.0.0.1:4173}"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/zongo-admin-role-matrix.XXXXXX")"
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

check_role() {
  role="$1"
  user="$2"
  totp="$3"
  cookie_jar="${TMP_DIR}/${role}.cookies"
  login_body="${TMP_DIR}/${role}.login.json"
  payload="$(jq -nc --arg user "$user" --arg totp "$totp" \
    '{userId:$user,totpCode:$totp}')"

  curl -sS --max-time 10 -o "$login_body" -c "$cookie_jar" \
    -H 'Content-Type: application/json' \
    -X POST "${BASE_URL}/admin/v1/auth/login" --data "$payload"
  jq -e 'has("accessToken") | not' "$login_body" >/dev/null
  expect_status 200 -b "$cookie_jar" "${BASE_URL}/admin/v1/auth/session"

  expect_status 200 -b "$cookie_jar" "${BASE_URL}/admin/v1/overview"
  expect_status 200 -b "$cookie_jar" \
    "${BASE_URL}/admin/v1/operations/search?page=1"
  expect_status 200 -b "$cookie_jar" "${BASE_URL}/admin/v1/reconciliation?page=1"
  expect_status 200 -b "$cookie_jar" "${BASE_URL}/admin/v1/beneficiaries?page=1"
  expect_status 200 -b "$cookie_jar" "${BASE_URL}/admin/v1/audit?page=1"
  expect_status 200 -b "$cookie_jar" "${BASE_URL}/admin/v1/pilot/readiness"

  case "$role" in
    SUPPORT)
      expect_status 403 -b "$cookie_jar" "${BASE_URL}/admin/v1/alerts?page=1"
      expect_status 403 -b "$cookie_jar" "${BASE_URL}/admin/v1/verification?page=1"
      expect_status 403 -b "$cookie_jar" "${BASE_URL}/admin/v1/admin-controls"
      ;;
    OPS)
      expect_status 200 -b "$cookie_jar" "${BASE_URL}/admin/v1/alerts?page=1"
      expect_status 200 -b "$cookie_jar" "${BASE_URL}/admin/v1/verification?page=1"
      expect_status 403 -b "$cookie_jar" "${BASE_URL}/admin/v1/admin-controls"
      ;;
    ADMIN)
      expect_status 200 -b "$cookie_jar" "${BASE_URL}/admin/v1/alerts?page=1"
      expect_status 200 -b "$cookie_jar" "${BASE_URL}/admin/v1/verification?page=1"
      expect_status 200 -b "$cookie_jar" "${BASE_URL}/admin/v1/admin-controls"
      ;;
    *)
      echo "unsupported role: ${role}" >&2
      exit 1
      ;;
  esac

  csrf_token="$(curl -fsS --max-time 10 -b "$cookie_jar" \
    "${BASE_URL}/admin/v1/auth/csrf" | jq -r '.token')"
  test -n "$csrf_token" && test "$csrf_token" != null
  expect_status 201 -b "$cookie_jar" -X POST \
    -H "X-CSRF-Token: ${csrf_token}" "${BASE_URL}/admin/v1/auth/logout"
}

test -n "${ADMIN_SMOKE_SUPPORT_USER:-}" &&
  test -n "${ADMIN_SMOKE_SUPPORT_TOTP:-}" &&
  test -n "${ADMIN_SMOKE_OPS_USER:-}" &&
  test -n "${ADMIN_SMOKE_OPS_TOTP:-}" &&
  test -n "${ADMIN_SMOKE_ADMIN_USER:-}" &&
  test -n "${ADMIN_SMOKE_ADMIN_TOTP:-}" || {
    echo "set all six role-matrix credential variables to run the three-role matrix" >&2
    exit 2
  }

check_role SUPPORT "$ADMIN_SMOKE_SUPPORT_USER" "$ADMIN_SMOKE_SUPPORT_TOTP"
check_role OPS "$ADMIN_SMOKE_OPS_USER" "$ADMIN_SMOKE_OPS_TOTP"
check_role ADMIN "$ADMIN_SMOKE_ADMIN_USER" "$ADMIN_SMOKE_ADMIN_TOTP"
echo "admin role matrix passed: ${BASE_URL}"
